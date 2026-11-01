import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class RevelioPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive with the window

        const switchRow = (key, title) => {
            const row = new Adw.SwitchRow({title});
            settings.bind(key, row, 'active', 0);
            return row;
        };
        const spinRow = (key, title, min, max, step) => {
            const row = Adw.SpinRow.new_with_range(min, max, step);
            row.title = title;
            settings.bind(key, row, 'value', 0);
            return row;
        };
        // String-valued keys (enums, monitor connector) as a combo of [value, label].
        const comboRow = (key, title, choices) => {
            const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices.map(c => c[1]))});
            row.selected = Math.max(0, choices.findIndex(c => c[0] === settings.get_string(key)));
            row.connect('notify::selected', () => settings.set_string(key, choices[row.selected][0]));
            return row;
        };
        const group = (title, rows) => {
            const g = new Adw.PreferencesGroup({title});
            rows.forEach(r => g.add(r));
            return g;
        };

        const general = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});
        general.add(group('Clock', [
            switchRow('clock-24h', '24-hour clock'),
            comboRow('idle-look', 'Idle look', [['clock', 'Clock'], ['minimal', 'Minimal'], ['hidden', 'Hidden until hover'],
                ['status-bar', 'Status bar']]),
        ]));

        const monitors = [['', 'Primary monitor']];
        const list = Gdk.Display.get_default().get_monitors();
        for (let i = 0; i < list.get_n_items(); i++) {
            const m = /** @type {Gdk.Monitor} */ (list.get_item(i));
            monitors.push([m.get_connector(), `${m.get_model() ?? ''} (${m.get_connector()})`.trim()]);
        }
        const saved = settings.get_string('monitor');
        if (saved && !monitors.some(m => m[0] === saved))
            monitors.push([saved, `${saved} (not connected)`]);

        const island = new Adw.PreferencesPage({title: 'Island', icon_name: 'video-display-symbolic'});
        island.add(group('Behaviour', [
            switchRow('expand-on-hover', 'Expand on hover'),
            spinRow('open-delay', 'Open delay (ms)', 0, 2000, 50),
            spinRow('close-delay', 'Close delay (ms)', 0, 5000, 50),
            spinRow('expanded-width', 'Open width (px)', 240, 900, 10),
        ]));
        island.add(group('Placement', [
            comboRow('monitor', 'Monitor', monitors),
            comboRow('fullscreen', 'Over full-screen apps', [['hide', 'Hide'], ['stay-on-top', 'Stay on top']]),
        ]));

        general.add(group('Focus timer', [
            spinRow('focus-minutes', 'Focus (minutes)', 1, 180, 1),
            spinRow('break-minutes', 'Short break (minutes)', 1, 60, 1),
            spinRow('long-break-minutes', 'Long break (minutes)', 1, 120, 1),
            switchRow('sounds', 'Sound when a session ends'),
        ]));

        const system = new Adw.PreferencesPage({title: 'System', icon_name: 'utilities-system-monitor-symbolic'});
        system.add(group('Power estimate', [
            spinRow('power-tdp', 'CPU at full load (W)', 5, 500, 5),
            spinRow('power-base', 'Everything else (W)', 0, 500, 5),
        ]));

        const addons = new Adw.PreferencesPage({title: 'Add-ons', icon_name: 'application-x-addon-symbolic'});
        addons.add(group('Add-ons', [
            switchRow('addon-notifications', 'Notifications on the island'),
            switchRow('addon-clipboard', 'Clipboard history (in memory only)'),
            switchRow('addon-script', 'Script reader'),
            switchRow('addon-recorder', 'Screen recorder tab'),
        ]));

        // One switch per app that has sent a notification since the add-on was turned on.
        const muted = () => settings.get_strv('notification-muted-apps');
        const appRows = settings.get_strv('notification-apps').sort().map(app => {
            const row = new Adw.SwitchRow({title: app, active: !muted().includes(app)});
            row.connect('notify::active', () => settings.set_strv('notification-muted-apps',
                row.active ? muted().filter(a => a !== app) : [...muted(), app]));
            return row;
        });
        const notifications = group('Notifications', [
            switchRow('notification-hide-sender', 'Hide the sender'),
            switchRow('notification-hide-text', 'Hide the text'),
        ]);
        addons.add(notifications);
        const apps = group('Apps', appRows);
        apps.description = appRows.length ? 'Show notifications from these apps on the island'
            : 'Apps appear here after they send a notification';
        addons.add(apps);

        const fileRow = new Adw.ActionRow({title: 'Script file'});
        const syncFile = () => (fileRow.subtitle = settings.get_string('script-file') || 'None (paste text on the island instead)');
        settings.connect('changed::script-file', syncFile);
        syncFile();
        const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
        choose.connect('clicked', async () => {
            const filter = new Gtk.FileFilter({name: 'Text files'});
            filter.add_mime_type('text/plain');
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
            filters.append(filter);
            try {
                const file = await new Gtk.FileDialog({filters}).open(window, null);
                settings.set_string('script-file', file.get_path() ?? '');
            } catch {} // cancelled
        });
        const clear = new Gtk.Button({icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Clear'});
        clear.connect('clicked', () => settings.set_string('script-file', ''));
        fileRow.add_suffix(choose);
        fileRow.add_suffix(clear);
        addons.add(group('Script reader', [fileRow, spinRow('script-wpm', 'Speed (words per minute)', 60, 300, 10)]));

        window.add(general);
        window.add(island);
        window.add(system);
        window.add(addons);
    }
}
