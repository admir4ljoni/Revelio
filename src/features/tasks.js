// Tasks (15): a to-do list page. Type in the entry and press Enter to add ("#work call Ana" puts it
// in the "work" category); click a task to tick it. Category chips filter the list. The pop-out
// button opens the same list in its own window (tasks-window.js), which can go full screen.
// Stored in ~/.local/share/revelio@midra/tasks.json; a file monitor keeps the two in step.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as store from '../lib/store.js';
import * as T from '../lib/tasks.js';

export class Tasks {
    constructor(island, extensionPath) {
        this._island = island;
        this._windowScript = GLib.build_filenamev([extensionPath, 'src', 'tasks-window.js']);
        this._tasks = T.clean(store.load('tasks', []));
        this._filter = null; // category shown, or null for all

        this._entry = new St.Entry({style_class: 'revelio-entry', hint_text: 'Add a task (#tag for a category), Enter to save',
            can_focus: true, x_expand: true,
            primary_icon: new St.Icon({icon_name: 'list-add-symbolic', style_class: 'revelio-entry-icon'})});
        const text = this._entry.clutter_text;
        text.connectObject(
            'key-focus-in', () => island.grabKeys(text),
            'activate', () => {
                const task = T.parse(text.text, this._filter);
                text.text = '';
                if (task.text)
                    this._change([...this._tasks, task]);
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
        this._clearDone.connect('clicked', () => {
            const shown = T.visible(this._tasks, this._filter);
            this._change(this._tasks.filter(t => !(t.done && shown.includes(t))));
        });
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

    _setFilter(tag) {
        this._filter = tag;
        this._render();
    }

    _render() {
        const tags = T.tags(this._tasks);
        if (this._filter && !tags.includes(this._filter))
            this._filter = null; // its last task went
        this._chips.destroy_all_children();
        this._chips.visible = tags.length > 0;
        for (const tag of [null, ...tags]) {
            const chip = new St.Button({style_class: 'revelio-segment revelio-chip', can_focus: true, label: tag ? `#${tag}` : 'All'});
            if (tag === this._filter)
                chip.add_style_pseudo_class('checked');
            chip.connect('clicked', () => this._setFilter(tag));
            this._chips.add_child(chip);
        }

        this._list.destroy_all_children();
        const shown = T.visible(this._tasks, this._filter);
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
            if (task.tag && !this._filter)
                box.add_child(new St.Label({style_class: 'revelio-tag', text: `#${task.tag}`, y_align: Clutter.ActorAlign.CENTER}));
            const toggle = new St.Button({child: box, x_expand: true, x_align: Clutter.ActorAlign.START, can_focus: true});
            toggle.connect('clicked', () => this._change(this._tasks.map(t => (t === task ? {...t, done: !t.done} : t))));
            const remove = new St.Button({style_class: 'revelio-row-action', can_focus: true,
                child: new St.Icon({icon_name: 'window-close-symbolic'})});
            remove.connect('clicked', () => this._change(this._tasks.filter(t => t !== task)));
            const row = new St.BoxLayout({style_class: 'revelio-list-row', x_expand: true, reactive: true, track_hover: true});
            row.add_child(toggle);
            row.add_child(remove);
            this._list.add_child(row);
        }
    }

    destroy() {
        this._monitor?.disconnectObject(this);
        this._monitor?.cancel();
        this._monitor = null;
        this._entry.clutter_text.disconnectObject(this);
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
