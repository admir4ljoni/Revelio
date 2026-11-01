// Lyrics (3, 4): synced lyrics from LRCLIB for the music track. Owned by Music, which feeds it the
// track and position. Shows a scrolling lyrics page plus the current line on the music page.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import St from 'gi://St';
import {parse, lineAt} from '../lib/lrc.js';

const API = 'https://lrclib.net/api';
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'revelio@midra', 'lyrics']);
const SCROLL_MS = 300;

const query = params => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export class Lyrics {
    constructor(island, soup) {
        this._island = island;
        this._soup = soup;
        this._cancellable = new Gio.Cancellable();
        this._key = null;
        this._lines = [];
        this._labels = [];
        this._index = -1;
        this._timerId = 0;
        this._shown = false;

        // Current line on the music page (4).
        this.line = new St.Label({style_class: 'revelio-lyric-line', visible: false});

        // Lyrics page (3): all lines in a column, slid so the current one sits in the middle.
        this._column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.START});
        this.page = new St.Widget({
            style_class: 'revelio-lyrics-page',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
            y_expand: true,
        });
        this.page.add_child(this._column);
        // Height goes 0 -> real on the first allocation after mapping; scroll then.
        this.page.connectObject('notify::mapped', () => this._scroll(false), 'notify::height', () => this._scroll(false), this);
    }

    // track: {title, artist, album, length (µs)} or null when no player.
    setTrack(track) {
        const key = track?.title ? JSON.stringify([track.artist, track.title, track.album, Math.round(track.length / 1e6)]) : null;
        if (key === this._key)
            return;
        this._key = key;
        this._setLines([]);
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        if (key)
            this._load(track, key, this._cancellable);
    }

    // Shows the line at `us`; when `run`, arms one timeout for the next line's timestamp. Never polls.
    sync(us, run) {
        this._base = {ms: us / 1000, at: GLib.get_monotonic_time()};
        this._run = run;
        this._tick();
    }

    _tick() {
        this._clearTimer();
        if (!this._lines.length || !this._base)
            return;
        const ms = this._base.ms + (this._run ? (GLib.get_monotonic_time() - this._base.at) / 1000 : 0);
        this._show(lineAt(this._lines, ms));
        const next = this._lines[this._index + 1];
        if (!this._run || !next)
            return;
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.ceil(next.t - ms)), () => {
            this._timerId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(i) {
        if (i === this._index)
            return;
        this._labels[this._index]?.remove_style_pseudo_class('active');
        this._index = i;
        this._labels[i]?.add_style_pseudo_class('active');
        this.line.text = this._lines[i]?.text || '♪';
        this._scroll(true);
    }

    _scroll(animate) {
        const col = this._column;
        col.remove_all_transitions();
        if (!col.mapped || !this.page.has_allocation() || !this._labels.length)
            return;
        // Lines are single-line labels, so all the same height.
        const [, lineH] = this._labels[0].get_preferred_height(-1);
        const y = Math.round(this.page.height / 2 - (Math.max(0, this._index) + 0.5) * lineH);
        if (animate)
            col.ease(/** @type {any} */ ({translation_y: y, duration: SCROLL_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD}));
        else
            col.translation_y = y;
    }

    _setLines(lines) {
        this._clearTimer();
        this._lines = lines;
        this._index = -1;
        this._column.destroy_all_children();
        this._labels = lines.map(l => {
            const label = new St.Label({style_class: 'revelio-lyric', text: l.text || '♪', x_align: Clutter.ActorAlign.CENTER});
            this._column.add_child(label);
            return label;
        });
        this.line.text = '♪';
        this.line.visible = lines.length > 0;
        const show = lines.length > 0;
        if (show && !this._shown)
            this._island.addPage(this.page);
        else if (!show && this._shown)
            this._island.removePage(this.page);
        this._shown = show;
        this._tick();
    }

    // --- fetching: cache first (hits and misses), then /api/get, then /api/search ---

    _cacheFile(key) {
        return Gio.File.new_for_path(GLib.build_filenamev(
            [CACHE_DIR, `${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, key, -1)}.json`]));
    }

    async _load(track, key, cancellable) {
        const file = this._cacheFile(key);
        try {
            const [, bytes] = file.load_contents(null);
            this._setLines(parse(JSON.parse(new TextDecoder().decode(bytes)).synced));
            return;
        } catch {
            // not cached
        }
        try {
            const secs = Math.round(track.length / 1e6);
            let synced = null, getFailed = false;
            if (track.artist && track.album && secs > 0) {
                // LRCLIB's /get throws the odd 503; fall back to search then, but don't cache a miss.
                const hit = await this._get(`/get?${query({artist_name: track.artist, track_name: track.title,
                    album_name: track.album, duration: secs})}`, cancellable).catch(e => {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        throw e;
                    getFailed = true;
                    return null;
                });
                synced = hit?.syncedLyrics ?? null;
            }
            if (!synced) {
                // Helps with "Remastered" / "feat." titles. Prefer a result within 3 s of the track length.
                const results = await this._get(`/search?${query({q: `${track.artist} ${track.title}`.trim()})}`, cancellable);
                const usable = (Array.isArray(results) ? results : []).filter(r => r.syncedLyrics);
                synced = (usable.find(r => !secs || Math.abs(r.duration - secs) <= 3) ?? (secs ? null : usable[0]))?.syncedLyrics ?? null;
            }
            if (synced || !getFailed) {
                GLib.mkdir_with_parents(CACHE_DIR, 0o755);
                file.replace_contents(new TextEncoder().encode(JSON.stringify({synced})), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            }
            if (this._key === key)
                this._setLines(parse(synced));
        } catch (e) {
            // Network errors aren't cached, so the next play of this track retries.
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                log(`Revelio: lyrics for ${track.title}: ${e.message}`);
        }
    }

    // JSON body, null on 404, throws on other errors.
    _get(path, cancellable) {
        const msg = Soup.Message.new('GET', API + path);
        return new Promise((resolve, reject) => {
            this._soup.send_and_read_async(msg, GLib.PRIORITY_LOW, cancellable, (_s, res) => {
                try {
                    const bytes = this._soup.send_and_read_finish(res);
                    const status = msg.get_status();
                    if (status === Soup.Status.NOT_FOUND)
                        resolve(null);
                    else if (status !== Soup.Status.OK)
                        reject(new Error(`HTTP ${status}`));
                    else
                        resolve(JSON.parse(new TextDecoder().decode(bytes.toArray())));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _clearTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
    }

    destroy() {
        this._cancellable.cancel();
        this._clearTimer();
        if (this._shown)
            this._island.removePage(this.page);
        this.page.destroy();
        this.line.destroy();
    }
}
