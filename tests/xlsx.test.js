// gjs -m tests/xlsx.test.js — builds a workbook and checks it with `unzip -t` and an XML parse of every part.
import GLib from 'gi://GLib';
import * as X from '../src/lib/xlsx.js';

const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

eq(X.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
eq(['A', 'Z', 'AA', 'AZ', 'BA'].map((_c, i) => X.colName([0, 25, 26, 51, 52][i])), ['A', 'Z', 'AA', 'AZ', 'BA']);
eq(X.parseRef('AB12'), [27, 12]);

const bytes = X.workbook([
    {
        name: 'Nov 2026', cols: [12, 20], heights: {1: 28},
        cells: [['A1', 'Title & <stuff>', {bold: true, size: 18}], ['A2', 'Food'], ['B2', 25000, {fmt: '"Rp "#,##0'}],
            ['A3', 'Fun'], ['B3', 10000, {fmt: '"Rp "#,##0', fill: 'F3F4F6'}], ['C3', null]],
        merges: ['A1:B1'],
        charts: [
            {type: 'doughnut', title: 'By category', from: 'D1', to: 'J12', cats: {ref: "'Nov 2026'!$A$2:$A$3", values: ['Food', 'Fun']},
                series: [{name: 'Spent', ref: "'Nov 2026'!$B$2:$B$3", values: [25000, 10000]}], colors: ['2A78D6', 'EB6834']},
            {type: 'line', title: 'Daily', from: 'D13', to: 'J24', cats: {ref: "'Nov 2026'!$A$2:$A$3", values: ['1', '2']},
                series: [{name: 'Spent', ref: "'Nov 2026'!$B$2:$B$3", values: [25000, null], color: '2A78D6'},
                    {name: 'Pace', ref: "'Nov 2026'!$B$2:$B$3", values: [1, 2], color: '8C959F', dash: true}]},
        ],
    },
    {name: 'Oct 2026', cells: [['A1', 1]]},
]);
const dir = GLib.dir_make_tmp('revelio-xlsx-XXXXXX'), path = `${dir}/t.xlsx`;
GLib.file_set_contents(path, bytes);
const run = argv => {
    const [, out, err, status] = GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
    const text = new TextDecoder().decode(out) + new TextDecoder().decode(err);
    if (status !== 0)
        throw new Error(`${argv.join(' ')} failed:\n${text}`);
    return text;
};
run(['unzip', '-tq', path]);
const parsed = run(['python3', '-I', '-c', `import sys, zipfile, xml.dom.minidom as m
z = zipfile.ZipFile(sys.argv[1])
for n in z.namelist(): m.parseString(z.read(n))
print(len(z.namelist()))`, path]);
eq(parsed.trim(), '12'); // types, 2 sheets, sheet rels, drawing + rels, 2 charts, workbook + rels, styles, .rels
GLib.spawn_sync(null, ['rm', '-rf', dir], null, GLib.SpawnFlags.SEARCH_PATH, null);
print('xlsx: ok');
