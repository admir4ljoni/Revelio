// gjs -m tests/store.test.js — runs against a throwaway XDG_DATA_HOME.
import GLib from 'gi://GLib';
const dir = GLib.dir_make_tmp('revelio-store-XXXXXX');
GLib.setenv('XDG_DATA_HOME', dir, true);
const store = await import('../src/lib/store.js');
const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const app = `${dir}/revelio@midra`;
eq(store.load('tasks', []), []); // missing
store.save('tasks', [{text: 'a'}]);
eq(store.load('tasks', []), [{text: 'a'}]);
GLib.file_set_contents(`${app}/tasks.json`, '[{"text": "a"'); // truncated
eq(store.load('tasks', []), []);
const names = [];
const d = GLib.Dir.open(app, 0);
for (let n; (n = d.read_name());)
    names.push(n);
eq(names.some(n => n.startsWith('tasks.json.broken-')), true); // kept, not overwritten
eq(names.includes('tasks.json'), false);
print('store: ok');
