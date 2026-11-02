// Small JSON files in ~/.local/share/revelio@midra (tasks, shelf). Gio only, no Shell imports.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'revelio@midra']);
const file = name => Gio.File.new_for_path(GLib.build_filenamev([DIR, `${name}.json`]));

// Missing: `fallback`. Unreadable or corrupt: the file is moved aside (name.json.broken-<time>)
// before returning `fallback`, so the next save can't overwrite the only copy.
export function load(name, fallback) {
    const f = file(name);
    try {
        const [, bytes] = f.load_contents(null);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return fallback;
        try {
            f.move(Gio.File.new_for_path(`${f.get_path()}.broken-${Date.now()}`), Gio.FileCopyFlags.NONE, null, null);
        } catch {}
        console.warn(`Revelio: ${name}.json unreadable (${e.message}); moved aside, starting empty`);
        return fallback;
    }
}

// replace_contents writes a temp file and renames it, so a crash never leaves half a file.
export function save(name, data) {
    GLib.mkdir_with_parents(DIR, 0o755);
    file(name).replace_contents(new TextEncoder().encode(JSON.stringify(data)), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
