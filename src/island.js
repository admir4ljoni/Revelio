// The island: collapsed/expanded states, animation, positioning, pages switched with arrow buttons.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ANIM_MS = 250;
const SLIDE_PX = 40; // page switch slides the new page in this far
const EXPANDED_HEIGHT = 140;
const COLLAPSED = {clock: [120, 32], minimal: [110, 12], hidden: [110, 12], 'status-bar': [230, 32]};
// Closed island with a feature's compact view: two equal wings keep the clock centered.
const WING = 150;
const COMPACT_CENTER = {clock: 120, minimal: 50, hidden: 50, 'status-bar': 120};
const COMPACT_HEIGHT = 32;

export class Island {
    constructor(settings) {
        this._settings = settings;
        this._expanded = false;
        this._paused = false;
        this._unredirectOff = false;
        this._timeoutId = 0;
        this._compacts = new Set();
        this._compact = null;
        this._popup = null;
        this._grab = null;
        this._status = [null, null];

        this.actor = new St.Widget({
            style_class: 'revelio-island',
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });
        // Closed bar: [left wing][beat ⅃ clock L beat][right wing]. Only the center opens on hover,
        // so the wings (song text, media buttons) stay usable.
        this._clockLabel = new St.Label({style_class: 'revelio-clock', y_align: Clutter.ActorAlign.CENTER});
        this._beatLeft = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        this._beatRight = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        this._center = new St.BoxLayout({
            style_class: 'revelio-center',
            reactive: true,
            track_hover: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._center.add_child(this._beatLeft);
        this._center.add_child(this._clockLabel);
        this._center.add_child(this._beatRight);
        this._leftWing = new St.Bin({x_expand: false, y_expand: true, visible: false});
        this._rightWing = new St.Bin({x_expand: false, y_expand: true, visible: false});
        this._bar = new St.BoxLayout({x_expand: true, y_expand: true});
        this._bar.add_child(this._leftWing);
        this._bar.add_child(this._center);
        this._bar.add_child(this._rightWing);
        // Open island: [‹][current page, one dot per page at the bottom][›]. Arrows switch pages
        // (no scrolling, so lists inside pages scroll freely).
        this._pageBin = new St.Bin({x_expand: true, y_expand: true});
        this._dots = new St.BoxLayout({style_class: 'revelio-dots', x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.END});
        const center = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true, clip_to_allocation: true});
        center.add_child(this._pageBin);
        center.add_child(this._dots);
        // Full-height strips, so the space above and below the arrow clicks too.
        const arrow = (icon, step) => {
            const b = new St.Button({style_class: 'revelio-arrow', can_focus: true, y_expand: true,
                child: new St.Icon({icon_name: icon, y_align: Clutter.ActorAlign.CENTER})});
            b.connect('clicked', () => this._showPage((this._page + step + this._pages.length) % this._pages.length, step));
            return b;
        };
        this._arrows = [arrow('go-previous-symbolic', -1), arrow('go-next-symbolic', 1)];
        this._open = new St.BoxLayout({x_expand: true, y_expand: true, visible: false, opacity: 0});
        this._open.add_child(this._arrows[0]);
        this._open.add_child(center);
        this._open.add_child(this._arrows[1]);
        this.actor.add_child(this._bar);
        this.actor.add_child(this._open);

        // Built-in first page until the feature pages arrive: big time and date.
        this._timeLabel = new St.Label({style_class: 'revelio-page-time', x_align: Clutter.ActorAlign.CENTER});
        this._dateLabel = new St.Label({style_class: 'revelio-page-date', x_align: Clutter.ActorAlign.CENTER});
        const clockPage = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
        clockPage.add_child(this._timeLabel);
        clockPage.add_child(this._dateLabel);
        this._pages = [clockPage];
        this._page = 0;
        this._pageBin.set_child(clockPage);
        this._renderDots();

        Main.layoutManager.addChrome(this.actor, {affectsStruts: false});

        this._clock = new GnomeDesktop.WallClock();
        this._clock.connectObject('notify::clock', () => this._updateClock(), this);
        this._settings.connectObject('changed', () => this._sync(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._sync(), this);
        global.display.connectObject('in-fullscreen-changed', () => this._syncVisibility(), this);
        this._center.connectObject('notify::hover', () => this._onHover(), this);
        this.actor.connectObject(
            'notify::hover', () => this._onHover(),
            'button-release-event', (_a, event) => {
                // Buttons, entries and lists handle their own clicks (media buttons, page widgets).
                const target = global.stage.get_event_actor(event);
                if (this._rightWing.contains(target) || (this._expanded && this._open.contains(target)))
                    return Clutter.EVENT_PROPAGATE;
                this._setExpanded(!this._expanded);
                return Clutter.EVENT_STOP;
            },
            'key-press-event', (_a, event) => {
                if (event.get_key_symbol() !== Clutter.KEY_Escape)
                    return Clutter.EVENT_PROPAGATE;
                this._setExpanded(false);
                return Clutter.EVENT_STOP;
            },
            this);

        this._sync();
    }

    // Pages are owned (and destroyed) by the features that add them.
    addPage(page) {
        this._pages.push(page);
        this._renderDots();
    }

    removePage(page) {
        const i = this._pages.indexOf(page);
        if (i <= 0)
            return;
        this._pages.splice(i, 1);
        if (this._page >= i)
            this._showPage(this._page === i ? 0 : this._page - 1);
        else
            this._renderDots();
    }

    // What the closed island shows for a feature: {left, right, beatLeft?, beatRight?, page, priority}.
    // The highest priority shown one wins. Actors stay owned by the feature. Opening shows `page`.
    showCompact(compact, show) {
        if (show)
            this._compacts.add(compact);
        else
            this._compacts.delete(compact);
        this._compact = [...this._compacts].sort((a, b) => b.priority - a.priority)[0] ?? null;
        this._applyCompact();
    }

    // Opens the island on `page` (a drag over the shelf).
    open(page) {
        this._setExpanded(true);
        const i = this._pages.indexOf(page);
        if (i >= 0)
            this._showPage(i);
    }

    // Typing into the island (an entry): Wayland keys go to the focused window unless the Shell
    // takes a modal grab. Held until the island closes (pointer leaves, click outside, Escape).
    grabKeys(actor) {
        this._grab ??= Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        actor.grab_key_focus();
    }

    _releaseKeys() {
        if (!this._grab)
            return;
        Main.popModal(this._grab);
        this._grab = null;
        global.stage.set_key_focus(null);
    }

    // A short message (see popups.js), {left, right} or null. Covers the compact view while set.
    setPopup(popup) {
        this._popup = popup;
        this._applyCompact();
    }

    // Icons around the clock for the status-bar idle look (volume, battery). Owned by the caller,
    // who must clear them (setStatus(null, null)) before destroying them.
    setStatus(left, right) {
        this._status = [left, right];
        this._applyCompact();
    }

    _look() {
        return this._settings.get_string('idle-look');
    }

    _applyCompact(animate = true) {
        const compact = this._popup ?? this._compact;
        const status = !compact && this._look() === 'status-bar' ? this._status : [null, null];
        this._leftWing.set_child(compact?.left ?? null);
        this._rightWing.set_child(compact?.right ?? null);
        this._beatLeft.set_child(compact?.beatLeft ?? status[0]);
        this._beatRight.set_child(compact?.beatRight ?? status[1]);
        this._updateClock();
        this._relayout(animate);
    }

    // Screen off: hide and stop updating.
    setPaused(paused) {
        this._paused = paused;
        if (paused)
            this._setExpanded(false);
        this._sync();
    }

    _sync() {
        this._applyCompact(false);
        this._syncVisibility();
    }

    _updateClock() {
        if (this._paused)
            return;
        const now = GLib.DateTime.new_now_local();
        const time = now.format(this._settings.get_boolean('clock-24h') ? '%H:%M' : '%-l:%M %p');
        const withDate = this._look() === 'status-bar' && !(this._popup ?? this._compact);
        this._clockLabel.text = withDate ? `${now.format('%a %-d %b')}  ${time}` : time;
        this._timeLabel.text = time;
        this._dateLabel.text = now.format('%A, %-d %B');
    }

    _monitor() {
        const lm = Main.layoutManager;
        const connector = this._settings.get_string('monitor');
        const i = connector ? global.backend.get_monitor_manager().get_monitor_for_connector(connector) : -1;
        return lm.monitors[i] ?? lm.primaryMonitor;
    }

    _relayout(animate) {
        const monitor = this._monitor();
        if (!monitor)
            return;
        const look = this._look();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const compact = this._popup ?? this._compact;
        let [w, h] = COLLAPSED[look];
        if (this._expanded)
            [w, h] = [this._settings.get_uint('expanded-width'), EXPANDED_HEIGHT];
        else if (compact)
            [w, h] = [2 * WING + COMPACT_CENTER[look], COMPACT_HEIGHT];
        const width = w * scale, height = h * scale;
        const geometry = {x: monitor.x + Math.round((monitor.width - width) / 2), y: monitor.y, width, height};
        const opacity = look === 'hidden' && !compact && !this._expanded && !this.actor.hover ? 0 : 255;

        this._bar.visible = !this._expanded;
        this._clockLabel.visible = look === 'clock' || look === 'status-bar';
        for (const wing of [this._leftWing, this._rightWing]) {
            wing.visible = !!compact;
            wing.width = WING * scale;
        }
        this.actor.remove_all_transitions();
        if (animate) {
            this.actor.ease({...geometry, opacity, duration: ANIM_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this.actor.set_position(geometry.x, geometry.y);
            this.actor.set_size(width, height);
            this.actor.opacity = opacity;
        }
    }

    _syncVisibility() {
        const fullscreen = this._monitor()?.inFullscreen ?? false;
        const hide = this._paused || (fullscreen && this._settings.get_string('fullscreen') === 'hide');
        this.actor.visible = !hide;

        // Over a full-screen window Mutter unredirects it and would paint over us.
        const keepRedirected = fullscreen && !hide;
        if (keepRedirected !== this._unredirectOff) {
            if (keepRedirected)
                global.compositor.disable_unredirect();
            else
                global.compositor.enable_unredirect();
            this._unredirectOff = keepRedirected;
        }
    }

    // Opens from the center only; closes when the pointer leaves the whole island.
    _onHover() {
        this._clearTimeout();
        if (this._expanded) {
            if (!this.actor.hover)
                this._delay('close-delay', false);
            return;
        }
        if (this._center.hover && this._settings.get_boolean('expand-on-hover'))
            this._delay('open-delay', true);
        else
            this._relayout(true); // hidden look: fade in/out
    }

    _delay(key, expanded) {
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._settings.get_uint(key), () => {
            this._timeoutId = 0;
            this._setExpanded(expanded);
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimeout() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
    }

    _setExpanded(expanded) {
        this._clearTimeout();
        if (!expanded)
            this._releaseKeys();
        if (expanded === this._expanded)
            return;
        this._expanded = expanded;
        const i = this._pages.indexOf(this._compact?.page);
        if (expanded && i > 0)
            this._showPage(i);
        if (expanded)
            this.actor.add_style_pseudo_class('expanded');
        else
            this.actor.remove_style_pseudo_class('expanded');
        this._open.remove_all_transitions();
        this._open.visible = true;
        this._open.ease({
            opacity: expanded ? 255 : 0,
            duration: ANIM_MS,
            onComplete: () => (this._open.visible = this._expanded),
        });
        this._relayout(true);
    }

    // step (±1) slides the new page in from that side.
    _showPage(i, step = 0) {
        this._page = i;
        this._pageBin.set_child(this._pages[i]);
        this._renderDots();
        const bin = this._pageBin;
        bin.remove_all_transitions();
        if (!step) {
            bin.translation_x = 0;
            bin.opacity = 255;
            return;
        }
        bin.translation_x = step * SLIDE_PX * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        bin.opacity = 0;
        bin.ease(/** @type {any} */ ({translation_x: 0, opacity: 255, duration: ANIM_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD}));
    }

    _renderDots() {
        this._dots.destroy_all_children();
        this._pages.forEach((_p, i) => {
            const dot = new St.Widget({style_class: 'revelio-dot'});
            if (i === this._page)
                dot.add_style_pseudo_class('active');
            this._dots.add_child(dot);
        });
        this._arrows.forEach(a => (a.visible = this._pages.length > 1));
    }

    destroy() {
        this._clearTimeout();
        this._releaseKeys();
        this._clock.disconnectObject(this);
        this._clock = null;
        this._settings.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        if (this._unredirectOff)
            global.compositor.enable_unredirect();
        // Leave feature actors to their owners; only the built-in ones die with the actor.
        this._popup = null;
        this._status = [null, null];
        this._compacts.clear();
        this.showCompact(null, false);
        if (this._page !== 0)
            this._pageBin.set_child(this._pages[0]);
        this.actor.destroy(); // layoutManager untracks chrome on destroy
        this._pages = [];
    }
}
