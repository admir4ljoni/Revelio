// gjs -m tests/pomodoro.test.js
import * as P from '../src/lib/pomodoro.js';

const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const d = {focus: 1500, break: 300, 'long-break': 900};

let s = P.initial();
eq(P.remaining(s, d, 0), 1500);
s = P.start(s, d, 1000);
eq([P.running(s), P.remaining(s, d, 1400)], [true, 1100]);
eq(P.start(s, d, 2000), s); // already running
s = P.pause(s, d, 1400);
eq([P.running(s), P.remaining(s, d, 99999)], [false, 1100]); // paused time doesn't count
s = P.start(s, d, 5000);
eq(P.tick(s, 6099), s);
s = P.tick(s, 60000); // ended long ago (suspend): advances once, stopped
eq(s, {phase: 'break', endsAt: 0, left: 0, done: 1});
eq(P.remaining(P.reset(P.pause(P.start(s, d, 0), d, 100)), d, 0), 300);
for (let i = 0; i < 3; i++)
    s = P.advance(P.advance(s)); // break -> focus -> break...
eq(s, {phase: 'long-break', endsAt: 0, left: 0, done: 4});
eq(P.advance(s).phase, 'focus');
print('pomodoro ok');
