// gjs -m tests/stats.test.js
import * as S from '../src/lib/stats.js';

const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

const a = S.parseCpu('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 50 0 50 350 50 0 0 0 0 0\ncpu1 50 0 50 350 50 0 0 0 0 0\nintr 5');
eq(a, [{total: 1000, idle: 800}, {total: 500, idle: 400}, {total: 500, idle: 400}]);
const b = S.parseCpu('cpu  200 0 200 800 100 0 0 0 0 0\ncpu0 150 0 50 400 50 0 0 0 0 0\ncpu1 50 0 50 350 50 0 0 0 0 0');
eq(S.cpuLoad(a, b).map(x => x.toFixed(3)), ["0.667", "0.667", "0.000"]);
eq(S.cpuLoad([], b), [0, 0, 0]);

eq(S.parseMeminfo('MemTotal:  1000 kB\nMemFree: 10 kB\nMemAvailable:   400 kB\n'), {total: 1024000, available: 409600});

const net = 'Inter-| head\n face |bytes\n    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  wlan0: 100 1 0 0 0 0 0 0 50 1 0 0 0 0 0 0\n   eth0:10 1 0 0 0 0 0 0 5 1 0 0 0 0 0 0\n';
eq(S.parseNetDev(net), {rx: 110, tx: 55});
eq(S.rate(100, 300, 2000), 100);
eq(S.rate(300, 100, 2000), 0); // counter reset
eq(S.wrapDelta(90, 10, 100), 20);
eq(S.wrapDelta(10, 30, 100), 20);

const p = S.parseProcStat('42 (Web Content (x)) S 1 1 1 0 -1 0 0 0 0 0 7 3 0 0 20 0 1 0 5');
eq(p, {name: 'Web Content (x)', ticks: 10});
const prev = new Map([[1, {name: 'a', ticks: 10}], [2, {name: 'b', ticks: 0}], [3, {name: 'b', ticks: 0}], [4, {name: 'c', ticks: 5}]]);
const cur = new Map([[1, {name: 'a', ticks: 30}], [2, {name: 'b', ticks: 15}], [3, {name: 'b', ticks: 15}], [4, {name: 'd', ticks: 50}], [5, {name: 'e', ticks: 99}]]);
eq(S.topApps(prev, cur, 100, 2), [{name: 'b', share: 0.3}, {name: 'a', share: 0.2}]); // pid reuse and new pids skipped
print('stats ok');
