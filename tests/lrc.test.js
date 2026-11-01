// gjs -m tests/lrc.test.js
import {parse, lineAt} from '../src/lib/lrc.js';

const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

const lines = parse('[ar:Someone]\n[00:12.34]Hello\r\n[00:05.00][01:00.5]Chorus\nno stamp\n[00:20]\n[1:02:250]x');
eq(lines.map(l => l.t), [5000, 12340, 20000, 60500, 62250]);
eq(lines.map(l => l.text), ['Chorus', 'Hello', '', 'Chorus', 'x']);
eq(parse(null), []);

eq(lineAt(lines, 0), -1);
eq(lineAt(lines, 5000), 0);
eq(lineAt(lines, 12339), 0);
eq(lineAt(lines, 12340), 1);
eq(lineAt(lines, 999999), 4);
eq(lineAt([], 100), -1);
print('lrc ok');
