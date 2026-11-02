// Focus (14, 8): Pomodoro page with start/pause, reset and skip. While running, the closed island
// shows the countdown (over music). State lives in GSettings, so it survives lock (we get disabled).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as P from '../lib/pomodoro.js';

const NAMES = {focus: 'Focus', break: 'Break', 'long-break': 'Long break'};
const SHORT = {focus: 'Focus', break: 'Short', 'long-break': 'Long'};
const RING = {focus: [1, 0.62, 0.26], break: [0.18, 0.76, 0.49], 'long-break': [0.47, 0.68, 0.93]};

const fmt = ms => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// A progress ring filling clockwise from the top, with an optional tick at `tick` (0..1).
// Also used by the Money tab.
export function paintRing(area, progress, rgb, tick = null) {
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const lw = Math.round(w / 18), r = (Math.min(w, h) - lw) / 2, top = -Math.PI / 2;
    cr.setLineWidth(lw);
    cr.setSourceRGBA(1, 1, 1, 0.1);
    cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
    cr.stroke();
    cr.setLineCap(1); // ROUND
    if (progress > 0) {
        cr.setSourceRGBA(...rgb, 1);
        cr.arc(w / 2, h / 2, r, top, top + Math.min(progress, 1) * 2 * Math.PI);
        cr.stroke();
    }
    if (tick !== null) {
        const a = top + tick * 2 * Math.PI, x = Math.cos(a), y = Math.sin(a);
        cr.setLineWidth(Math.max(2, lw / 3));
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.moveTo(w / 2 + x * (r - lw), h / 2 + y * (r - lw)); // from inside the ring to the edge
        cr.lineTo(w / 2 + x * (r + lw / 2), h / 2 + y * (r + lw / 2));
        cr.stroke();
    }
    cr.$dispose();
}

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

        // Left: countdown inside a progress ring. Right: phase chips, buttons, today's sessions.
        this._ring = new St.DrawingArea({style_class: 'revelio-focus-ring'});
        this._ring.connect('repaint', area => paintRing(area, this._progress, RING[this._state.phase]));
        this._phase = new St.Label({style_class: 'revelio-focus-phase', x_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'revelio-focus-time', x_align: Clutter.ActorAlign.CENTER});
        const inner = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        inner.add_child(this._time);
        inner.add_child(this._phase);
        const dial = new St.Widget({layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        dial.add_child(this._ring);
        dial.add_child(inner);

        this._chips = {};
        const chips = new St.BoxLayout({style_class: 'revelio-segmented', x_align: Clutter.ActorAlign.START});
        for (const phase of Object.keys(NAMES)) {
            const minutes = new St.Label({style_class: 'revelio-dim', y_align: Clutter.ActorAlign.CENTER});
            const box = new St.BoxLayout({style_class: 'revelio-pill-box'});
            box.add_child(new St.Label({text: SHORT[phase], y_align: Clutter.ActorAlign.CENTER}));
            box.add_child(minutes);
            const chip = new St.Button({style_class: 'revelio-segment', can_focus: true, child: box});
            chip.connect('clicked', () => this._set({...P.reset(this._state), phase}));
            this._chips[phase] = {chip, minutes};
            chips.add_child(chip);
        }

        const button = (icon, text, cls, action) => {
            const box = new St.BoxLayout({style_class: 'revelio-pill-box'});
            const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER});
            const iconActor = new St.Icon({icon_name: icon});
            box.add_child(iconActor);
            box.add_child(label);
            const b = new St.Button({style_class: `revelio-pill ${cls}`, can_focus: true, child: box});
            b.connect('clicked', () => this._set(action(this._state, this._durations(), Date.now())));
            return Object.assign(b, {_label: label, _icon: iconActor});
        };
        this._start = button('media-playback-start-symbolic', 'Start', 'revelio-pill-accent',
            (s, d, now) => (P.running(s) ? P.pause : P.start)(s, d, now));
        this._reset = button('view-refresh-symbolic', 'Reset', '', P.reset);
        const buttons = new St.BoxLayout({style_class: 'revelio-row'});
        buttons.add_child(this._start);
        buttons.add_child(this._reset);
        buttons.add_child(button('media-skip-forward-symbolic', 'Skip', '', P.advance));

        const dots = new St.BoxLayout({style_class: 'revelio-focus-dots', y_align: Clutter.ActorAlign.CENTER});
        this._dots = Array.from({length: P.LONG_EVERY}, () => new St.Widget({style_class: 'revelio-focus-dot'}));
        this._dots.forEach(dot => dots.add_child(dot));
        this._sessions = new St.Label({style_class: 'revelio-dim', y_align: Clutter.ActorAlign.CENTER});
        const sessions = new St.BoxLayout({style_class: 'revelio-row'});
        sessions.add_child(dots);
        sessions.add_child(this._sessions);

        const side = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-focus-side',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        side.add_child(chips);
        side.add_child(buttons);
        side.add_child(sessions);
        this.page = new St.BoxLayout({style_class: 'revelio-focus-page', x_expand: true});
        this.page.add_child(dial);
        this.page.add_child(side);

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
        const s = this._state, run = P.running(s), d = this._durations(), ms = P.remaining(s, d, now);
        this._progress = 1 - ms / d[s.phase];
        this._phase.text = NAMES[s.phase];
        this._compactPhase.text = NAMES[s.phase];
        this._time.text = this._compactTime.text = fmt(ms);
        this._start._icon.icon_name = run ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._start._label.text = run ? 'Pause' : s.left ? 'Resume' : 'Start';
        this._reset.reactive = run || s.left > 0;
        for (const [phase, {chip, minutes}] of Object.entries(this._chips)) {
            minutes.text = String(d[phase] / 60000);
            if (phase === s.phase)
                chip.add_style_pseudo_class('checked');
            else
                chip.remove_style_pseudo_class('checked');
        }
        const inCycle = s.done % P.LONG_EVERY;
        this._dots.forEach((dot, i) => (i < inCycle ? dot.add_style_pseudo_class('checked') : dot.remove_style_pseudo_class('checked')));
        this._sessions.text = s.done ? `${s.done} focus session${s.done === 1 ? '' : 's'} done` : 'No focus sessions yet';
        this._ring.queue_repaint();
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
