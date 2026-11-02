// Tasks window: the island's to-do list in a normal window that can be resized, maximized or made
// full screen (F11). Run with `gjs -m tasks-window.js`; one instance (a second launch raises it).
// Reads and writes the same tasks.json as the Tasks tab, and reloads when the island changes it.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import * as store from './lib/store.js';
import * as T from './lib/tasks.js';

const HINT = 'Add a task (#tag category, @tomorrow 9:00 deadline), Enter to save';
const DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'revelio@midra']);

class TasksWindow {
    constructor(app) {
        this._tasks = T.clean(store.load('tasks', []));
        this._filter = null;
        this._editing = null; // the task the entry is renaming

        this._entry = new Gtk.Entry({placeholder_text: HINT, hexpand: true, primary_icon_name: 'list-add-symbolic'});
        this._entry.connect('activate', () => {
            const editing = this._editing;
            const task = editing ? T.edit(editing, this._entry.text) : T.parse(this._entry.text, this._filter);
            this._setEditing(null);
            if (task.text)
                this._change(editing ? this._tasks.map(t => (t === editing ? task : t)) : [...this._tasks, task]);
        });
        this._chips = new Gtk.Box({spacing: 6});
        this._list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
        this._empty = new Adw.StatusPage({icon_name: 'checkbox-checked-symbolic', title: 'Nothing to do', vexpand: true});
        this._count = new Gtk.Label({css_classes: ['dim-label'], hexpand: true, xalign: 0});
        this._clearDone = new Gtk.Button({label: 'Clear done', css_classes: ['pill']});
        this._clearDone.connect('clicked', () => {
            const shown = T.visible(this._tasks, this._filter);
            this._change(this._tasks.filter(t => !(t.done && shown.includes(t))));
        });
        const footer = new Gtk.Box({spacing: 12});
        footer.append(this._count);
        footer.append(this._clearDone);

        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
            margin_top: 12, margin_bottom: 18, margin_start: 12, margin_end: 12});
        for (const w of [this._entry, this._chips, this._list, this._empty, footer])
            content.append(w);
        const scroll = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true,
            child: new Adw.Clamp({maximum_size: 760, child: content})});

        const fullscreen = new Gtk.Button({icon_name: 'view-fullscreen-symbolic', tooltip_text: 'Full screen (F11)'});
        const header = new Adw.HeaderBar();
        header.pack_end(fullscreen);
        const view = new Adw.ToolbarView({content: scroll});
        view.add_top_bar(header);
        this.window = new Adw.ApplicationWindow({application: app, title: 'Tasks', default_width: 560, default_height: 680,
            content: view});
        const toggleFullscreen = () => (this.window.fullscreened ? this.window.unfullscreen() : this.window.fullscreen());
        fullscreen.connect('clicked', toggleFullscreen);
        this.window.connect('notify::fullscreened', () =>
            (fullscreen.icon_name = this.window.fullscreened ? 'view-restore-symbolic' : 'view-fullscreen-symbolic'));
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, key) => {
            if (key === 0xffc8) // F11
                toggleFullscreen();
            else if (key === 0xff1b && this.window.fullscreened) // Escape
                this.window.unfullscreen();
            else
                return false;
            return true;
        });
        this.window.add_controller(keys);

        // The island saves with an atomic rename, hence watching the directory.
        GLib.mkdir_with_parents(DIR, 0o755);
        this._monitor = Gio.File.new_for_path(DIR).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitor.connect('changed', (_m, file, other) => {
            if ([file, other].some(f => f?.get_basename() === 'tasks.json'))
                this._reload();
        });
        this.window.connect('close-request', () => {
            this._monitor.cancel();
            return false;
        });
        this._render();
    }

    _reload() {
        const tasks = T.clean(store.load('tasks', []));
        if (JSON.stringify(tasks) === JSON.stringify(this._tasks))
            return; // our own save
        this._tasks = tasks;
        this._render();
    }

    _change(tasks) {
        this._tasks = tasks;
        try {
            store.save('tasks', tasks);
        } catch (e) {
            const dialog = new Adw.AlertDialog({heading: 'Couldn’t save tasks', body: e.message});
            dialog.add_response('ok', 'OK');
            dialog.present(this.window);
        }
        this._render();
    }

    _setEditing(task) {
        this._editing = task;
        this._entry.placeholder_text = task ? 'Edit the task, Enter to save (empty cancels)' : HINT;
        this._entry.primary_icon_name = task ? 'document-edit-symbolic' : 'list-add-symbolic';
        this._entry.text = task ? T.format(task) : '';
        if (task)
            this._entry.grab_focus();
    }

    _render() {
        const now = Date.now();
        if (this._editing && !this._tasks.includes(this._editing))
            this._setEditing(null);
        const tags = T.tags(this._tasks);
        // Stays while selected, so ticking the last overdue task doesn't jump back to All.
        const hasOverdue = this._filter === T.OVERDUE || this._tasks.some(t => T.overdue(t, now));
        if (this._filter && this._filter !== T.OVERDUE && !tags.includes(this._filter))
            this._filter = null;
        for (let c; (c = this._chips.get_first_child());)
            this._chips.remove(c);
        const chips = [null, ...hasOverdue ? [T.OVERDUE] : [], ...tags];
        this._chips.visible = chips.length > 1;
        let group = null;
        for (const tag of chips) {
            const chip = new Gtk.ToggleButton({label: tag === T.OVERDUE ? 'Overdue' : tag ? `#${tag}` : 'All', active: tag === this._filter, css_classes: ['pill'], group});
            group ??= chip;
            chip.connect('toggled', () => {
                if (chip.active && this._filter !== tag) {
                    this._filter = tag;
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { // not from inside the toggled signal
                        this._render();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
            this._chips.append(chip);
        }

        this._list.remove_all();
        const shown = T.visible(this._tasks, this._filter, now);
        const done = shown.filter(t => t.done).length;
        this._count.label = shown.length ? `${done}/${shown.length} done` : '';
        this._clearDone.visible = done > 0;
        this._list.visible = shown.length > 0;
        this._empty.visible = !shown.length;
        for (const task of shown) {
            const check = new Gtk.CheckButton({active: !!task.done, valign: Gtk.Align.CENTER});
            check.connect('toggled', () => this._change(this._tasks.map(t => (t === task ? {...t, done: check.active} : t))));
            const late = T.overdue(task, now);
            const row = new Adw.ActionRow({title: GLib.markup_escape_text(task.text, -1), activatable_widget: check,
                subtitle: late && task.reason ? GLib.markup_escape_text(`Declined: ${task.reason}`, -1) : ''});
            if (task.done)
                row.add_css_class('dim-label');
            row.add_prefix(check);
            // Its own category stays in view under Overdue.
            if (task.tag && this._filter !== task.tag)
                row.add_suffix(new Gtk.Label({label: `#${task.tag}`, css_classes: ['accent', 'caption'], valign: Gtk.Align.CENTER}));
            if (task.due) {
                row.add_suffix(new Gtk.Label({label: late ? `Overdue · ${T.dueLabel(task.due, now)}` : T.dueLabel(task.due, now),
                    css_classes: [late ? 'error' : 'dim-label', 'caption'], valign: Gtk.Align.CENTER}));
            }
            const edit = new Gtk.Button({icon_name: 'document-edit-symbolic', css_classes: ['flat'], valign: Gtk.Align.CENTER,
                tooltip_text: 'Edit'});
            edit.connect('clicked', () => this._setEditing(task));
            row.add_suffix(edit);
            const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', css_classes: ['flat'], valign: Gtk.Align.CENTER,
                tooltip_text: 'Remove'});
            remove.connect('clicked', () => this._change(this._tasks.filter(t => t !== task)));
            row.add_suffix(remove);
            this._list.append(row);
        }
    }
}

const app = new Adw.Application({application_id: 'io.github.midra.Revelio.Tasks', flags: Gio.ApplicationFlags.DEFAULT_FLAGS});
let win = null;
app.connect('activate', () => {
    win ??= new TasksWindow(app);
    win.window.present();
});
app.run([]);
