// The pill: collapsed/expanded states, animation, positioning, pages, scroll-to-switch.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ANIM_MS = 250;
const EXPANDED_HEIGHT = 140;
const COLLAPSED = {clock: [120, 32], minimal: [110, 12], hidden: [110, 12]};

export class Island {
    constructor(settings) {
        this._settings = settings;
        this._expanded = false;
        this._paused = false;
        this._unredirectOff = false;
        this._timeoutId = 0;
        this._scrollAcc = 0;

        this.actor = new St.Widget({
            style_class: 'revelio-island',
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._clockLabel = new St.Label({
            style_class: 'revelio-clock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pageBin = new St.Bin({x_expand: true, y_expand: true, visible: false, opacity: 0});
        this.actor.add_child(this._clockLabel);
        this.actor.add_child(this._pageBin);

        // Built-in first page until the feature pages arrive: big time and date.
        this._timeLabel = new St.Label({style_class: 'revelio-page-time', x_align: Clutter.ActorAlign.CENTER});
        this._dateLabel = new St.Label({style_class: 'revelio-page-date', x_align: Clutter.ActorAlign.CENTER});
        const clockPage = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
        clockPage.add_child(this._timeLabel);
        clockPage.add_child(this._dateLabel);
        this._pages = [clockPage];
        this._page = 0;
        this._pageBin.set_child(clockPage);

        Main.layoutManager.addChrome(this.actor, {affectsStruts: false});

        this._clock = new GnomeDesktop.WallClock();
        this._clock.connectObject('notify::clock', () => this._updateClock(), this);
        this._settings.connectObject('changed', () => this._sync(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._sync(), this);
        global.display.connectObject('in-fullscreen-changed', () => this._syncVisibility(), this);
        this.actor.connectObject(
            'notify::hover', () => this._onHover(),
            'button-release-event', () => {
                this._setExpanded(!this._expanded);
                return Clutter.EVENT_STOP;
            },
            'scroll-event', (_a, event) => this._onScroll(event),
            this);

        this._sync();
    }

    // Pages are owned (and destroyed) by the features that add them.
    addPage(page) {
        this._pages.push(page);
    }

    removePage(page) {
        const i = this._pages.indexOf(page);
        if (i <= 0)
            return;
        this._pages.splice(i, 1);
        if (this._page >= i)
            this._showPage(this._page === i ? 0 : this._page - 1);
    }

    // Screen off: hide and stop updating.
    setPaused(paused) {
        this._paused = paused;
        if (paused)
            this._setExpanded(false);
        this._sync();
    }

    _sync() {
        this._updateClock();
        this._relayout(false);
        this._syncVisibility();
    }

    _updateClock() {
        if (this._paused)
            return;
        const now = GLib.DateTime.new_now_local();
        const time = now.format(this._settings.get_boolean('clock-24h') ? '%H:%M' : '%-l:%M %p');
        this._clockLabel.text = time;
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
        const look = this._settings.get_string('idle-look');
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const [w, h] = this._expanded
            ? [this._settings.get_uint('expanded-width'), EXPANDED_HEIGHT]
            : COLLAPSED[look];
        const width = w * scale, height = h * scale;
        const geometry = {x: monitor.x + Math.round((monitor.width - width) / 2), y: monitor.y, width, height};
        const opacity = look === 'hidden' && !this._expanded && !this.actor.hover ? 0 : 255;

        this._clockLabel.visible = !this._expanded && look === 'clock';
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

    _onHover() {
        this._clearTimeout();
        if (this.actor.hover && !this._expanded && this._settings.get_boolean('expand-on-hover'))
            this._delay('open-delay', true);
        else if (!this.actor.hover && this._expanded)
            this._delay('close-delay', false);
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
        if (expanded === this._expanded)
            return;
        this._expanded = expanded;
        if (expanded)
            this.actor.add_style_pseudo_class('expanded');
        else
            this.actor.remove_style_pseudo_class('expanded');
        this._pageBin.remove_all_transitions();
        this._pageBin.visible = true;
        this._pageBin.ease({
            opacity: expanded ? 255 : 0,
            duration: ANIM_MS,
            onComplete: () => (this._pageBin.visible = this._expanded),
        });
        this._relayout(true);
    }

    _onScroll(event) {
        if (!this._expanded || this._pages.length < 2)
            return Clutter.EVENT_PROPAGATE;
        let step = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            step = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            step = 1;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            this._scrollAcc += Math.abs(dy) > Math.abs(dx) ? dy : dx;
            if (Math.abs(this._scrollAcc) >= 1) {
                step = Math.sign(this._scrollAcc);
                this._scrollAcc = 0;
            }
        }
        }
        if (step)
            this._showPage((this._page + step + this._pages.length) % this._pages.length);
        return Clutter.EVENT_STOP;
    }

    _showPage(i) {
        this._page = i;
        this._pageBin.set_child(this._pages[i]);
    }

    destroy() {
        this._clearTimeout();
        this._clock.disconnectObject(this);
        this._clock = null;
        this._settings.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        if (this._unredirectOff)
            global.compositor.enable_unredirect();
        // Leave feature pages to their owners; only the built-in page dies with the actor.
        if (this._page !== 0)
            this._pageBin.set_child(this._pages[0]);
        this.actor.destroy(); // layoutManager untracks chrome on destroy
        this._pages = [];
    }
}
