// Focus (14, 8): Pomodoro page with start/pause, reset and skip. While running, the closed island
// shows the countdown (over music). State lives in GSettings, so it survives lock (we get disabled).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as P from '../lib/pomodoro.js';

const NAMES = {focus: 'Focus', break: 'Break', 'long-break': 'Long break'};

const fmt = ms => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Focus {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._tickId = 0;
        try {
            this._state = {...P.initial(), ...JSON.parse(settings.get_string('focus-state'))};
        } catch {
            this._state = P.initial();
        }

        const button = (icon, action) => {
            const b = new St.Button({style_class: 'revelio-media-button', can_focus: true, child: new St.Icon({icon_name: icon})});
            b.connect('clicked', () => this._set(action(this._state, this._durations(), Date.now())));
            return b;
        };
        this._phase = new St.Label({style_class: 'revelio-focus-phase', x_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'revelio-focus-time', x_align: Clutter.ActorAlign.CENTER});
        this._start = button('media-playback-start-symbolic', (s, d, now) => (P.running(s) ? P.pause : P.start)(s, d, now));
        const buttons = new St.BoxLayout({style_class: 'revelio-media-controls', x_align: Clutter.ActorAlign.CENTER});
        buttons.add_child(button('view-refresh-symbolic', P.reset));
        buttons.add_child(this._start);
        buttons.add_child(button('media-skip-forward-symbolic', P.advance));
        this.page = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.page.add_child(this._phase);
        this.page.add_child(this._time);
        this.page.add_child(buttons);

        // Closed island while running: phase on the left, countdown on the right.
        this._compactPhase = new St.Label({style_class: 'revelio-popup-text', y_align: Clutter.ActorAlign.CENTER});
        const left = new St.BoxLayout({style_class: 'revelio-wing-left', x_expand: true});
        left.add_child(new St.Icon({style_class: 'revelio-popup-icon', icon_name: 'alarm-symbolic', y_align: Clutter.ActorAlign.CENTER}));
        left.add_child(this._compactPhase);
        this._compactTime = new St.Label({style_class: 'revelio-clock', y_align: Clutter.ActorAlign.CENTER});
        const right = new St.Bin({child: this._compactTime, x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        this._compact = {left, right, page: this.page, priority: 2};

        island.addPage(this.page, 'Focus', 'alarm-symbolic');
        const sync = () => this._sync();
        settings.connectObject('changed::focus-minutes', sync, 'changed::break-minutes', sync,
            'changed::long-break-minutes', sync, this);
        this._sync();
    }

    _durations() {
        const min = key => this._settings.get_uint(key) * 60000;
        return {focus: min('focus-minutes'), break: min('break-minutes'), 'long-break': min('long-break-minutes')};
    }

    _set(state) {
        this._state = state;
        this._settings.set_string('focus-state', JSON.stringify(state));
        this._sync();
    }

    _sync() {
        const now = Date.now();
        const next = P.tick(this._state, now);
        if (next !== this._state) { // a phase ended (maybe while locked or suspended)
            if (this._settings.get_boolean('sounds'))
                global.display.get_sound_player().play_from_theme('complete', `${NAMES[this._state.phase]} finished`, null);
            this._set(next);
            return;
        }
        const s = this._state, run = P.running(s), left = fmt(P.remaining(s, this._durations(), now));
        this._phase.text = `${NAMES[s.phase]} · ${s.done} done`;
        this._compactPhase.text = NAMES[s.phase];
        this._time.text = this._compactTime.text = left;
        /** @type {St.Icon} */ (this._start.child).icon_name = run ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._island.showCompact(this._compact, run);

        // Once a second, only while running.
        if (run && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._sync();
                return this._tickId ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            });
        } else if (!run && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    destroy() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._settings.disconnectObject(this);
        this._island.showCompact(this._compact, false);
        this._island.removePage(this.page);
        for (const a of [this.page, this._compact.left, this._compact.right])
            a.destroy();
    }
}
