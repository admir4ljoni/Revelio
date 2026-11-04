// Tasks (15): a to-do list page. Type in the entry and press Enter to add ("#work call Ana" puts it
// in the "work" category, "@tomorrow 9:00" sets a deadline); click a task to tick it, the pencil to
// edit it in the entry. Category chips filter the list; Overdue shows tasks past their deadline.
// When a deadline passes, the closed island shows it above everything else until it's accepted
// (done) or declined with a reason (it stays, overdue). The pop-out
// button opens the same list in its own window (tasks-window.js), which can go full screen.
// Stored in ~/.local/share/revelio@midra/tasks.json; a file monitor keeps the two in step.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as store from '../lib/store.js';
import * as T from '../lib/tasks.js';

const RING_S = 30, RINGS = 10; // ponytail: fixed; a setting if someone wants it longer or quieter
const HINT = 'Add a task (#tag category, @tomorrow 9:00 deadline), Enter to save';

export class Tasks {
    constructor(island, extensionPath, settings) {
        this._island = island;
        this._settings = settings;
        this._timeoutId = 0;
        this._editing = null; // the task the entry is renaming
        this._declining = null; // the alert the entry asks a reason for
        this._alertKey = null; // the alert showing, to ring for each new one
        this._ringId = 0;
        this._rings = 0;
        this._windowScript = GLib.build_filenamev([extensionPath, 'src', 'tasks-window.js']);
        this._tasks = T.clean(store.load('tasks', []));
        this._filter = null; // category shown, or null for all

        this._entry = new St.Entry({style_class: 'revelio-entry', hint_text: HINT,
            can_focus: true, x_expand: true,
            primary_icon: new St.Icon({icon_name: 'list-add-symbolic', style_class: 'revelio-entry-icon'})});
        const text = this._entry.clutter_text;
        text.connectObject(
            'key-focus-in', () => island.grabKeys(text),
            'activate', () => {
                const input = text.text.trim();
                if (this._declining) {
                    if (input) // a decline needs its reason
                        this._answer(this._declining, {reason: input});
                    return;
                }
                const editing = this._editing;
                this._setMode(null, null);
                const task = editing ? T.edit(editing, input) : T.parse(input, this._filter);
                if (task.text)
                    this._change(editing ? this._tasks.map(t => (t === editing ? task : t)) : [...this._tasks, task]);
            },
            this);
        this._chips = new St.BoxLayout({style_class: 'revelio-segmented', y_align: Clutter.ActorAlign.CENTER});
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._list,
        });
        this._count = new St.Label({style_class: 'revelio-dim', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._count.clutter_text.x_align = Clutter.ActorAlign.END; // sits after the chips
        this._clearDone = new St.Button({style_class: 'revelio-pill revelio-pill-small', label: 'Clear done', can_focus: true});
        this._clearDone.connect('clicked', () => this._change(T.clearDone(this._tasks, this._filter)));
        const popOut = new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true,
            child: new St.Icon({icon_name: 'window-new-symbolic'})});
        popOut.connect('clicked', () => this._openWindow());
        const footer = new St.BoxLayout({style_class: 'revelio-row'});
        footer.add_child(this._chips);
        footer.add_child(this._count);
        footer.add_child(this._clearDone);
        footer.add_child(popOut);
        this.page = new St.BoxLayout({style_class: 'revelio-tasks-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.page.add_child(this._entry);
        this.page.add_child(scroll);
        this.page.add_child(footer);
        // Entry modes end when the page goes away (the island closes).
        this.page.connect('notify::mapped', () => {
            if (!this.page.mapped && (this._editing || this._declining))
                this._setMode(null, null);
        });

        // A passed deadline: at the top of the page, and on the closed island over everything else.
        this._alertText = new St.Label({style_class: 'revelio-task-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const accept = this._alertButton('Accept', 'object-select-symbolic');
        accept.connect('clicked', () => this._answer(this._alert, {done: true}));
        const decline = this._alertButton('Decline', 'window-close-symbolic');
        decline.connect('clicked', () => this._decline());
        this._alertBar = new St.BoxLayout({style_class: 'revelio-row revelio-task-alert'});
        this._alertBar.add_child(new St.Icon({icon_name: 'alarm-symbolic', style_class: 'revelio-task-icon revelio-overdue'}));
        this._alertBar.add_child(this._alertText);
        this._alertBar.add_child(accept);
        this._alertBar.add_child(decline);
        this.page.insert_child_at_index(this._alertBar, 0);

        this._compactText = new St.Label({style_class: 'revelio-popup-text', y_align: Clutter.ActorAlign.CENTER});
        const left = new St.BoxLayout({style_class: 'revelio-wing-left', x_expand: true});
        left.add_child(new St.Icon({style_class: 'revelio-popup-icon revelio-overdue', icon_name: 'alarm-symbolic',
            y_align: Clutter.ActorAlign.CENTER}));
        left.add_child(this._compactText);
        const right = new St.BoxLayout({style_class: 'revelio-wing-right', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        for (const b of [accept, decline]) {
            const icon = new St.Button({style_class: 'revelio-media-button', can_focus: true,
                child: new St.Icon({icon_name: b === accept ? 'object-select-symbolic' : 'window-close-symbolic'})});
            icon.connect('clicked', () => b.emit('clicked', 1));
            right.add_child(icon);
        }
        this._compact = {left, right, page: this.page, priority: 10};

        island.addPage(this.page, 'Tasks', 'checkbox-checked-symbolic');
        this._render();

        // The window saves to the same file (an atomic rename, hence watching the directory).
        const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'revelio@midra']);
        const dir = Gio.File.new_for_path(path);
        try {
            GLib.mkdir_with_parents(path, 0o755); // so there's a directory to watch before the first save
            this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitor.connectObject('changed', (_m, file, other) => {
                if ([file, other].some(f => f?.get_basename() === 'tasks.json'))
                    this._reload();
            }, this);
        } catch (e) {
            logError(e, 'Revelio: watching tasks');
        }
    }

    _reload() {
        const tasks = T.clean(store.load('tasks', []));
        if (JSON.stringify(tasks) === JSON.stringify(this._tasks))
            return; // our own save
        this._tasks = tasks;
        this._render();
    }

    _openWindow() {
        this._island.close();
        try {
            Gio.Subprocess.new(['gjs', '-m', this._windowScript], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'Revelio: opening the tasks window');
        }
    }

    _change(tasks) {
        this._tasks = tasks;
        try {
            store.save('tasks', tasks);
        } catch (e) {
            logError(e, 'Revelio: saving tasks');
        }
        this._render();
    }

    _alertButton(label, icon) {
        const box = new St.BoxLayout({style_class: 'revelio-tab-box'});
        box.add_child(new St.Icon({icon_name: icon}));
        box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
        return new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true, child: box});
    }

    // The entry adds tasks, renames `editing`, or asks why `declining` was declined.
    _setMode(editing, declining) {
        this._editing = editing;
        this._declining = declining;
        this._entry.hint_text = declining ? `Why decline “${declining.text}”? Enter to save`
            : editing ? 'Edit the task, Enter to save (empty cancels)' : HINT;
        this._entry.text = editing ? T.format(editing) : '';
        if (editing || declining)
            this._island.grabKeys(this._entry.clutter_text);
    }

    _decline() {
        const task = this._alert;
        if (!task)
            return;
        this._island.open(this.page);
        this._setMode(null, task);
    }

    _answer(task, change) {
        if (this._declining === task)
            this._setMode(null, null);
        if (task && this._tasks.includes(task))
            this._change(this._tasks.map(t => (t === task ? {...t, ...change} : t)));
    }

    // Wakes at the next deadline. ponytail: capped at a minute because the monotonic timer stops
    // during suspend; cheap, and only runs while a deadline is pending.
    _schedule() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        const next = T.nextDue(this._tasks);
        if (next === null)
            return;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.min(Math.ceil((next - Date.now()) / 1000), 60), () => {
            this._timeoutId = 0;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Like an alarm: now, then every RING_S until answered, at most RINGS times.
    _ring() {
        this._stopRinging();
        if (!this._settings.get_boolean('sounds'))
            return;
        const play = () => global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', 'Task due', null);
        play();
        this._rings = 1;
        this._ringId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RING_S, () => {
            play();
            if (++this._rings < RINGS)
                return GLib.SOURCE_CONTINUE;
            this._ringId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopRinging() {
        if (this._ringId)
            GLib.source_remove(this._ringId);
        this._ringId = 0;
    }

    _setFilter(tag) {
        this._filter = tag;
        this._render();
    }

    _render() {
        const now = Date.now();
        if (this._editing && !this._tasks.includes(this._editing))
            this._setMode(null, null); // gone (the window changed the list)
        const alerts = T.alerts(this._tasks, now);
        this._alert = alerts[0] ?? null;
        if (this._declining && !alerts.includes(this._declining))
            this._setMode(null, null);
        this._alertBar.visible = !!this._alert;
        if (this._alert) {
            const more = alerts.length > 1 ? ` (+${alerts.length - 1})` : '';
            this._alertText.text = `“${this._alert.text}” was due ${T.dueLabel(this._alert.due, now)}${more}`;
            this._compactText.text = this._alert.text;
            const key = `${this._alert.text}@${this._alert.due}`;
            if (key !== this._alertKey)
                this._ring();
            this._alertKey = key;
        } else {
            this._alertKey = null;
            this._stopRinging();
        }
        this._island.showCompact(this._compact, !!this._alert);
        this._schedule();

        const tags = T.tags(this._tasks);
        // Stays while selected, so ticking the last overdue task doesn't jump back to All.
        const hasOverdue = this._filter === T.OVERDUE || this._tasks.some(t => T.overdue(t, now));
        if (this._filter && this._filter !== T.OVERDUE && !tags.includes(this._filter))
            this._filter = null; // its last task went
        this._chips.destroy_all_children();
        const chips = [null, ...hasOverdue ? [T.OVERDUE] : [], ...tags];
        this._chips.visible = chips.length > 1;
        for (const tag of chips) {
            const name = tag === T.OVERDUE ? 'Overdue' : tag ? `#${tag}` : 'All';
            const chip = new St.Button({style_class: 'revelio-segment revelio-chip', can_focus: true, label: name});
            if (tag === this._filter)
                chip.add_style_pseudo_class('checked');
            chip.connect('clicked', () => this._setFilter(tag));
            this._chips.add_child(chip);
        }

        this._list.destroy_all_children();
        const shown = T.visible(this._tasks, this._filter, now);
        const done = shown.filter(t => t.done).length;
        this._count.text = shown.length ? `${done}/${shown.length} done` : '';
        this._clearDone.visible = done > 0;
        if (!shown.length) {
            this._list.add_child(new St.Label({style_class: 'revelio-dim revelio-empty', text: 'Nothing to do',
                x_align: Clutter.ActorAlign.CENTER}));
        }
        for (const task of shown) {
            const label = new St.Label({style_class: 'revelio-task-text', text: task.text, y_align: Clutter.ActorAlign.CENTER});
            if (task.done)
                label.add_style_pseudo_class('done');
            const box = new St.BoxLayout({style_class: 'revelio-task-toggle'});
            box.add_child(new St.Icon({icon_name: task.done ? 'radio-checked-symbolic' : 'radio-symbolic',
                style_class: `revelio-task-icon${task.done ? ' revelio-accent' : ''}`}));
            box.add_child(label);
            if (task.reason && T.overdue(task, now))
                box.add_child(new St.Label({style_class: 'revelio-dim', text: `· ${task.reason}`, y_align: Clutter.ActorAlign.CENTER}));
            // Its own category stays in view under Overdue.
            if (task.tag && this._filter !== task.tag)
                box.add_child(new St.Label({style_class: 'revelio-tag', text: `#${task.tag}`, y_align: Clutter.ActorAlign.CENTER}));
            if (task.due) {
                const late = T.overdue(task, now);
                box.add_child(new St.Label({style_class: `revelio-tag${late ? ' revelio-tag-overdue' : ''}`,
                    text: late ? `Overdue · ${T.dueLabel(task.due, now)}` : T.dueLabel(task.due, now),
                    y_align: Clutter.ActorAlign.CENTER}));
            }
            const toggle = new St.Button({child: box, x_expand: true, x_align: Clutter.ActorAlign.START, can_focus: true});
            toggle.connect('clicked', () => this._change(this._tasks.map(t => (t === task ? {...t, done: !t.done} : t))));
            const edit = new St.Button({style_class: 'revelio-row-action', can_focus: true,
                child: new St.Icon({icon_name: 'document-edit-symbolic'})});
            edit.connect('clicked', () => this._setMode(task, null));
            const remove = new St.Button({style_class: 'revelio-row-action', can_focus: true,
                child: new St.Icon({icon_name: 'window-close-symbolic'})});
            remove.connect('clicked', () => this._change(this._tasks.filter(t => t !== task)));
            const row = new St.BoxLayout({style_class: 'revelio-list-row', x_expand: true, reactive: true, track_hover: true});
            row.add_child(toggle);
            row.add_child(edit);
            row.add_child(remove);
            this._list.add_child(row);
        }
    }

    destroy() {
        this._stopRinging();
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._island.showCompact(this._compact, false);
        this._compact.left.destroy();
        this._compact.right.destroy();
        this._monitor?.disconnectObject(this);
        this._monitor?.cancel();
        this._monitor = null;
        this._entry.clutter_text.disconnectObject(this);
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
