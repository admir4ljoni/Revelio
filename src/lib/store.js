// Small JSON files in ~/.local/share/revelio@midra (tasks, shelf). Gio only, no Shell imports.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'revelio@midra']);
const file = name => Gio.File.new_for_path(GLib.build_filenamev([DIR, `${name}.json`]));

export function load(name, fallback) {
    try {
        const [, bytes] = file(name).load_contents(null);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return fallback; // missing or corrupt
    }
}

// replace_contents writes a temp file and renames it, so a crash never leaves half a file.
export function save(name, data) {
    GLib.mkdir_with_parents(DIR, 0o755);
    file(name).replace_contents(new TextEncoder().encode(JSON.stringify(data)), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
