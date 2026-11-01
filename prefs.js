import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
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
                ['status-bar', 'Status bar (Pill theme)']]),
        ]));
        general.add(group('Theme', [
            comboRow('theme', 'Theme', [['classic', 'Classic'], ['glass', 'Glass'], ['pill', 'Pill']]),
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

        window.add(general);
        window.add(island);
        window.add(system);
    }
}
