// Tasks (15): a to-do list page. Type in the entry and press Enter to add; click a task to tick it.
// Stored in ~/.local/share/revelio@midra/tasks.json.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as store from '../lib/store.js';

export class Tasks {
    constructor(island) {
        this._island = island;
        const saved = store.load('tasks', []);
        this._tasks = Array.isArray(saved) ? saved.filter(t => typeof t?.text === 'string') : [];

        this._entry = new St.Entry({style_class: 'revelio-entry', hint_text: 'Add a task, Enter to save', can_focus: true, x_expand: true,
            primary_icon: new St.Icon({icon_name: 'list-add-symbolic', style_class: 'revelio-entry-icon'})});
        const text = this._entry.clutter_text;
        text.connectObject(
            'key-focus-in', () => island.grabKeys(text),
            'activate', () => {
                const t = text.text.trim();
                text.text = '';
                if (t)
                    this._change([...this._tasks, {text: t, done: false}]);
            },
            this);
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._list,
        });
        this._count = new St.Label({style_class: 'revelio-dim', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._clearDone = new St.Button({style_class: 'revelio-pill revelio-pill-small', label: 'Clear done', can_focus: true});
        this._clearDone.connect('clicked', () => this._change(this._tasks.filter(t => !t.done)));
        const footer = new St.BoxLayout();
        footer.add_child(this._count);
        footer.add_child(this._clearDone);
        this.page = new St.BoxLayout({style_class: 'revelio-tasks-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.page.add_child(this._entry);
        this.page.add_child(scroll);
        this.page.add_child(footer);
        island.addPage(this.page, 'Tasks', 'checkbox-checked-symbolic');
        this._render();
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

    _render() {
        this._list.destroy_all_children();
        const done = this._tasks.filter(t => t.done).length;
        this._count.text = this._tasks.length ? `${done}/${this._tasks.length} done` : '';
        this._clearDone.visible = done > 0;
        if (!this._tasks.length) {
            this._list.add_child(new St.Label({style_class: 'revelio-dim revelio-empty', text: 'Nothing to do',
                x_align: Clutter.ActorAlign.CENTER}));
        }
        this._tasks.forEach((task, i) => {
            const label = new St.Label({style_class: 'revelio-task-text', text: task.text, y_align: Clutter.ActorAlign.CENTER});
            if (task.done)
                label.add_style_pseudo_class('done');
            const box = new St.BoxLayout({style_class: 'revelio-task-toggle'});
            box.add_child(new St.Icon({icon_name: task.done ? 'radio-checked-symbolic' : 'radio-symbolic',
                style_class: `revelio-task-icon${task.done ? ' revelio-accent' : ''}`}));
            box.add_child(label);
            const toggle = new St.Button({child: box, x_expand: true, x_align: Clutter.ActorAlign.START, can_focus: true});
            toggle.connect('clicked', () => this._change(this._tasks.map((t, j) => (j === i ? {...t, done: !t.done} : t))));
            const remove = new St.Button({style_class: 'revelio-row-action', can_focus: true,
                child: new St.Icon({icon_name: 'window-close-symbolic'})});
            remove.connect('clicked', () => this._change(this._tasks.filter((_t, j) => j !== i)));
            const row = new St.BoxLayout({style_class: 'revelio-list-row', x_expand: true, reactive: true, track_hover: true});
            row.add_child(toggle);
            row.add_child(remove);
            this._list.add_child(row);
        });
    }

    destroy() {
        this._entry.clutter_text.disconnectObject(this);
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
