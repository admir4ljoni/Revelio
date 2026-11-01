// Music (1, 2, 7): follows MPRIS players, shows a compact view on the closed island and a
// music page with art, controls and a seek bar when open. Feeds the track to Lyrics (3, 4).
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Soup from 'gi://Soup';
import St from 'gi://St';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import {Lyrics} from './lyrics.js';
import {accent} from '../lib/color.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';
// The Shell's bundled MPRIS XML lacks Position/SetPosition/Seeked, so carry our own.
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(`<node><interface name="${IFACE}">
  <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
</interface></node>`);

const MARQUEE_PX_PER_S = 30;
const BEAT_MS = [380, 290, 340, 430]; // one per bar; uneven so it doesn't look mechanical
const BAR_IDLE = 0.35; // scale_y while paused
const ART_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'revelio@midra', 'art']);
const ART_CACHE = 10; // album covers kept in memory

const fmt = us => {
    const s = Math.max(0, Math.floor(us / 1e6));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Music {
    constructor(island) {
        this._island = island;
        this._players = new Map(); // bus name -> {proxy, stamp}
        this._player = null;
        this._cancellable = new Gio.Cancellable();
        this._soup = new Soup.Session({user_agent: 'Revelio (GNOME Shell extension)'});
        this._tickId = 0;
        this._pos = 0; // µs at this._posAt
        this._posAt = 0;
        this._dragging = false;
        this._artUrl = null;
        this._artCache = new Map(); // url -> GLib.Bytes, insertion order = age
        this._bars = []; // [actor, ms]
        this._lyrics = new Lyrics(island, this._soup);
        this._lyrics.page.connectObject('notify::mapped', () => this._syncTick(true), this);

        this._buildCompact();
        this._buildPage();

        const bus = Gio.DBus.session;
        this._nameSub = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2',
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE, (_c, _s, _p, _i, _n, params) => {
                const [name, , owner] = /** @type {string[]} */ (params.deepUnpack());
                if (!name.startsWith(PREFIX))
                    return;
                this._remove(name);
                if (owner)
                    this._add(name);
            });
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, this._cancellable, (_c, res) => {
                try {
                    const [names] = /** @type {[string[]]} */ (bus.call_finish(res).deepUnpack());
                    names.filter(n => n.startsWith(PREFIX)).forEach(n => this._add(n));
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, 'Revelio: ListNames');
                }
            });
    }

    // --- UI ---

    _controls() {
        const box = new St.BoxLayout({style_class: 'revelio-media-controls', y_align: Clutter.ActorAlign.CENTER});
        const button = (icon, action) => {
            const b = new St.Button({style_class: 'revelio-media-button', can_focus: true});
            b.child = new St.Icon({icon_name: icon});
            b.connect('clicked', () => this._player?.proxy[`${action}Async`]().catch(logError));
            box.add_child(b);
            return b;
        };
        return {
            box,
            prev: button('media-skip-backward-symbolic', 'Previous'),
            play: button('media-playback-start-symbolic', 'PlayPause'),
            next: button('media-skip-forward-symbolic', 'Next'),
        };
    }

    _beatHalf() {
        const box = new St.BoxLayout({style_class: 'revelio-beat'});
        for (let i = 0; i < 2; i++) {
            const bar = new St.Widget({style_class: 'revelio-beat-bar', pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
            const ms = BEAT_MS[this._bars.length % BEAT_MS.length];
            this._bars.push([bar, ms]);
            // Clutter skips transitions on unmapped actors, so react to the bar's own mapping.
            bar.connectObject('notify::mapped', () => this._syncBar(bar, ms), this);
            box.add_child(bar);
        }
        return box;
    }

    _buildCompact() {
        // Marquee: two copies of the text side by side, slid left by one copy's width, looped.
        this._marquee = new St.Widget({clip_to_allocation: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._marqueeBox = new St.BoxLayout({style_class: 'revelio-marquee'});
        this._marqueeText = [new St.Label(), new St.Label({visible: false})];
        this._marqueeText.forEach(l => this._marqueeBox.add_child(l));
        this._marquee.add_child(this._marqueeBox);
        this._marqueeBox.connectObject('notify::mapped', () => this._syncMarquee(), this);
        this._marquee.connectObject('notify::width', () => this._syncMarquee(), this);
        this._compactArt = new St.Icon({style_class: 'revelio-art-small', fallback_icon_name: 'audio-x-generic-symbolic',
            y_align: Clutter.ActorAlign.CENTER});
        const left = new St.BoxLayout({style_class: 'revelio-wing-left', x_expand: true});
        left.add_child(this._compactArt);
        left.add_child(this._marquee);

        this._compactControls = this._controls();
        const right = new St.Bin({child: this._compactControls.box, x_expand: true, x_align: Clutter.ActorAlign.CENTER});

        this._beats = [this._beatHalf(), this._beatHalf()];
        this._compact = {left, right, beatLeft: this._beats[0], beatRight: this._beats[1], priority: 1};
    }

    _buildPage() {
        this._art = new St.Icon({style_class: 'revelio-art', fallback_icon_name: 'audio-x-generic-symbolic'});
        this._title = new St.Label({style_class: 'revelio-track-title'});
        this._artist = new St.Label({style_class: 'revelio-track-artist'});
        this._pageControls = this._controls();
        this._slider = new Slider.Slider(0);
        this._slider.x_expand = true;
        this._slider.connectObject(
            'drag-begin', () => (this._dragging = true),
            'notify::value', () => this._dragging && this._showTime(this._slider.value * this._length()),
            'drag-end', () => this._seekTo(this._slider.value * this._length()),
            this);
        this._time = new St.Label({style_class: 'revelio-track-time', y_align: Clutter.ActorAlign.CENTER});

        const seek = new St.BoxLayout();
        seek.add_child(this._slider);
        seek.add_child(this._time);
        const info = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        info.add_child(this._title);
        info.add_child(this._artist);
        info.add_child(this._lyrics.line);
        info.add_child(this._pageControls.box);
        info.add_child(seek);
        this.page = new St.BoxLayout({style_class: 'revelio-music-page', x_expand: true});
        this.page.add_child(this._art);
        this.page.add_child(info);
        this.page.connectObject('notify::mapped', () => this._syncTick(true), this);
        this._compact.page = this.page;
    }

    // --- players ---

    _add(name) {
        const entry = {proxy: null, stamp: 0};
        this._players.set(name, entry);
        PlayerProxy(Gio.DBus.session, name, PATH, (proxy, error) => {
            if (this._players.get(name) !== entry)
                return; // vanished or disabled meanwhile
            if (error) {
                this._players.delete(name);
                return;
            }
            entry.proxy = proxy;
            entry.stamp = GLib.get_monotonic_time();
            proxy.connectObject(
                'g-properties-changed', (_p, changed) => {
                    if (changed.lookup_value('PlaybackStatus', null) && proxy.PlaybackStatus === 'Playing')
                        entry.stamp = GLib.get_monotonic_time();
                    this._choose();
                },
                'g-signal', (_p, _sender, signal, params) => {
                    if (signal === 'Seeked' && entry === this._player)
                        this._setPos(params.deepUnpack()[0]);
                },
                this);
            this._choose();
        }, this._cancellable, Gio.DBusProxyFlags.DO_NOT_AUTO_START);
    }

    _remove(name) {
        this._players.get(name)?.proxy?.disconnectObject(this);
        if (this._players.delete(name))
            this._choose();
    }

    // The playing player wins, else the one that played most recently. Ignore players without a track.
    _choose() {
        const live = [...this._players.values()].filter(e => e.proxy && this._meta(e.proxy).title);
        const rank = e => (e.proxy.PlaybackStatus === 'Playing' ? 1e15 : 0) + e.stamp;
        const best = live.sort((a, b) => rank(b) - rank(a))[0] ?? null;
        const changed = best !== this._player;
        if (changed && !this._player)
            this._island.addPage(this.page, 'Music', 'audio-x-generic-symbolic');
        this._player = best;
        if (!best) {
            this._island.showCompact(this._compact, false);
            this._island.removePage(this.page);
            this._lyrics.setTrack(null);
            this._syncTick(false);
            return;
        }
        if (changed)
            this._island.showCompact(this._compact, true);
        this._update();
    }

    _meta(proxy) {
        const m = proxy.Metadata ?? {};
        const get = k => {
            try {
                return m[k]?.deepUnpack();
            } catch {
                return undefined;
            }
        };
        const artists = get('xesam:artist');
        return {
            title: typeof get('xesam:title') === 'string' ? get('xesam:title') : '',
            album: typeof get('xesam:album') === 'string' ? get('xesam:album') : '',
            artist: Array.isArray(artists) ? artists.join(', ') : String(artists ?? ''),
            artUrl: get('mpris:artUrl') ?? '',
            length: Number(get('mpris:length') ?? 0),
            trackId: String(get('mpris:trackid') ?? '/'),
        };
    }

    _update() {
        const proxy = this._player.proxy;
        const m = this._meta(proxy);
        const playing = proxy.PlaybackStatus === 'Playing';
        const text = m.artist ? `${m.title} - ${m.artist}` : m.title;
        const trackChanged = this._trackKey !== `${m.trackId}|${text}`;
        this._trackKey = `${m.trackId}|${text}`;
        if (trackChanged)
            this._setPos(0); // re-read below when visible
        else if (playing !== this._playing)
            this._setPos(this._now()); // rebase, or pausing jumps back to the last read position
        this._playing = playing;
        this._lyrics.setTrack(m);

        this._marqueeText.forEach(l => (l.text = text));
        this._title.text = m.title;
        this._artist.text = m.artist;
        for (const c of [this._compactControls, this._pageControls]) {
            /** @type {St.Icon} */ (c.play.child).icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            c.prev.reactive = !!proxy.CanGoPrevious;
            c.next.reactive = !!proxy.CanGoNext;
        }
        this._slider.reactive = !!proxy.CanSeek && m.length > 0;
        this._setArt(m.artUrl);
        this._syncAnimations(trackChanged);
        this._syncTick(trackChanged);
    }

    // --- album art: kept in memory, since browsers delete their file:// art when the media
    // session switches (play a voice note, come back: same URL, file gone). http(s) is also
    // cached on disk across sessions. ---

    _setArt(url) {
        if (url === this._artUrl)
            return;
        this._artUrl = url;
        this._showArt(this._artCache.get(url) ?? null);
        if (this._artCache.has(url))
            return;
        if (url.startsWith('file://')) {
            this._loadArt(url, Gio.File.new_for_uri(url));
            return;
        }
        if (!/^https?:\/\//.test(url))
            return;
        const file = Gio.File.new_for_path(GLib.build_filenamev(
            [ART_DIR, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)]));
        if (file.query_exists(null)) {
            this._loadArt(url, file);
            return;
        }
        let msg;
        try {
            msg = Soup.Message.new('GET', url);
        } catch {
            return;
        }
        this._soup.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancellable, (_s, res) => {
            try {
                const bytes = this._soup.send_and_read_finish(res);
                if (msg.get_status() !== Soup.Status.OK)
                    return;
                GLib.mkdir_with_parents(ART_DIR, 0o755);
                file.replace_contents(bytes.toArray(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                this._gotArt(url, bytes);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    log(`Revelio: album art ${url}: ${e.message}`);
            }
        });
    }

    _loadArt(url, file) {
        file.load_contents_async(this._cancellable, (_f, res) => {
            try {
                const [, contents] = file.load_contents_finish(res);
                this._gotArt(url, new GLib.Bytes(contents));
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    log(`Revelio: album art ${url}: ${e.message}`);
            }
        });
    }

    _gotArt(url, bytes) {
        this._artCache.set(url, bytes);
        if (this._artCache.size > ART_CACHE)
            this._artCache.delete(this._artCache.keys().next().value); // oldest first
        if (this._artUrl === url)
            this._showArt(bytes);
    }

    _showArt(bytes) {
        const gicon = bytes ? new Gio.BytesIcon({bytes}) : null;
        this._art.gicon = gicon;
        this._compactArt.gicon = gicon;
        this._shownArt = bytes;
        if (!bytes) {
            this._setAccent(null);
            return;
        }
        // Tint from a tiny decode of the cover; once per cover, off the main loop's hot path.
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(Gio.MemoryInputStream.new_from_bytes(bytes),
            24, 24, false, this._cancellable, (_s, res) => {
                let rgb = null;
                try {
                    const pb = GdkPixbuf.Pixbuf.new_from_stream_finish(res);
                    rgb = accent(pb.get_pixels(), pb.n_channels, pb.rowstride, pb.width, pb.height);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                }
                if (this._shownArt === bytes)
                    this._setAccent(rgb);
            });
    }

    // Accent from the cover on the beat bars, seek bar and lyrics; null = default white.
    _setAccent(rgb) {
        const color = rgb ? `rgb(${rgb.join(',')})` : null;
        this._bars.forEach(([bar]) => (bar.style = color && `background-color: ${color};`));
        this._slider.style = color && `-barlevel-active-background-color: ${color};`;
        this._lyrics.setAccent(color);
    }

    // --- animations: only while playing and on screen (unmapped = island open, hidden or screen off) ---

    _syncAnimations(reset = false) {
        if (reset)
            this._marqueeBox.translation_x = 0;
        this._syncMarquee();
        this._bars.forEach(([bar, ms]) => this._syncBar(bar, ms));
    }

    _syncMarquee() {
        const playing = !!this._player && this._playing;
        const box = this._marqueeBox;
        box.remove_all_transitions(); // leaves translation_x where it was, so a pause freezes the text
        if (!box.mapped) {
            box.translation_x = 0;
            return; // leave the layout alone, or it reflows to full width and remeasures stale on remap
        }
        // Right after a remap the actor isn't allocated yet and .width reports its preferred width;
        // the wing is fixed-size, so use the last real width.
        if (this._marquee.has_allocation())
            this._marqueeW = this._marquee.width;
        const [, textW] = this._marqueeText[0].get_preferred_width(-1);
        const overflow = textW > (this._marqueeW ?? Infinity);
        this._marqueeText[1].visible = overflow;
        if (!overflow)
            box.translation_x = 0;
        if (!overflow || !playing)
            return;
        const dist = textW + box.get_theme_node().get_length('spacing');
        const msPerPx = 1000 / (MARQUEE_PX_PER_S * St.ThemeContext.get_for_stage(global.stage).scale_factor);
        const loop = () => box.ease(/** @type {any} */ ({ // snake_case: Shell's ease() needs it to attach repeatCount
            translation_x: -dist,
            duration: dist * msPerPx,
            mode: Clutter.AnimationMode.LINEAR,
            repeatCount: -1,
        }));
        // Resuming mid-scroll: finish this lap from where it froze, then loop from the start.
        const x = box.translation_x;
        if (!x)
            return loop();
        box.ease(/** @type {any} */ ({
            translation_x: -dist,
            duration: Math.max(1, (dist + x) * msPerPx),
            mode: Clutter.AnimationMode.LINEAR,
            onStopped: finished => {
                if (!finished)
                    return;
                box.translation_x = 0;
                loop();
            },
        }));
    }

    _syncBar(bar, ms) {
        bar.remove_all_transitions();
        if (!bar.mapped) {
            bar.scale_y = BAR_IDLE;
            return;
        }
        if (!this._player || !this._playing) {
            bar.ease({scale_y: BAR_IDLE, duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUAD}); // settle, don't snap
            return;
        }
        bar.ease(/** @type {any} */ ({
            scale_y: 1,
            duration: ms,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        }));
    }

    // --- seek bar: read Position once, interpolate on a 1 s timer only while the page is visible and playing ---

    _length() {
        return this._player ? this._meta(this._player.proxy).length : 0;
    }

    _now() {
        return this._pos + (this._playing ? GLib.get_monotonic_time() - this._posAt : 0);
    }

    _setPos(us) {
        this._pos = us;
        this._posAt = GLib.get_monotonic_time();
        this._renderPos();
        this._syncLyrics();
    }

    // Lyrics' line timer runs only while the music or lyrics page is on screen and playing.
    _syncLyrics() {
        const visible = !!this._player && (this.page.mapped || this._lyrics.page.mapped);
        this._lyrics.sync(this._now(), visible && this._playing);
    }

    _renderPos() {
        const len = this._length();
        const now = Math.min(this._now(), len || Infinity);
        // Off stage, a value change makes AT-SPI clients query the unstaged slider, which floods the
        // log with "not in the stage". Mapping the page re-renders (see _syncTick).
        if (!this._dragging && this._slider.mapped)
            this._slider.value = len > 0 ? now / len : 0;
        this._showTime(now);
    }

    _showTime(us) {
        const len = this._length();
        this._time.text = len > 0 ? `${fmt(us)} / ${fmt(len)}` : fmt(us);
    }

    _syncTick(reread) {
        const visible = !!this._player && this.page.mapped;
        if (reread && this._player && (visible || this._lyrics.page.mapped))
            this._readPosition();
        const want = visible && this._playing;
        if (want && !this._tickId) {
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._renderPos();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!want && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (visible)
            this._renderPos();
        this._syncLyrics();
    }

    // Position never arrives via PropertiesChanged, so ask for it.
    _readPosition() {
        const proxy = this._player.proxy;
        proxy.call('org.freedesktop.DBus.Properties.Get', new GLib.Variant('(ss)', [IFACE, 'Position']),
            Gio.DBusCallFlags.NONE, -1, this._cancellable, (_p, res) => {
                try {
                    const [v] = proxy.call_finish(res).deepUnpack();
                    if (proxy === this._player?.proxy)
                        this._setPos(Number(v.unpack()));
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._setPos(0); // player doesn't report Position
                }
            });
    }

    _seekTo(us) {
        this._dragging = false;
        if (!this._player)
            return;
        const {trackId} = this._meta(this._player.proxy);
        this._player.proxy.SetPositionAsync(trackId, Math.round(us)).catch(logError);
        this._setPos(us); // Seeked will correct it
    }

    destroy() {
        this._cancellable.cancel();
        this._soup.abort();
        Gio.DBus.session.signal_unsubscribe(this._nameSub);
        if (this._tickId)
            GLib.source_remove(this._tickId);
        for (const e of this._players.values())
            e.proxy?.disconnectObject(this);
        this._players.clear();
        this._artCache.clear();
        if (this._player) {
            this._island.showCompact(this._compact, false);
            this._island.removePage(this.page);
        }
        this._player = null;
        this._lyrics.destroy(); // before the page, which holds its line label
        for (const a of [this._compact.left, this._compact.right, ...this._beats, this.page])
            a.destroy();
    }
}
