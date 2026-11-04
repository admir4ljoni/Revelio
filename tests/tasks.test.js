// gjs -m tests/tasks.test.js
import * as T from '../src/lib/tasks.js';

const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

eq(T.parse('buy milk'), {text: 'buy milk', done: false});
eq(T.parse('call Ana #Work'), {text: 'call Ana', done: false, tag: 'work'});
eq(T.parse('#home fix  the sink'), {text: 'fix the sink', done: false, tag: 'home'});
eq(T.parse('#a #b two tags'), {text: '#b two tags', done: false, tag: 'a'});
eq(T.parse('issue#3 stays'), {text: 'issue#3 stays', done: false}); // not a tag mid-word
eq(T.parse('tugas #kuliah'), {text: 'tugas', done: false, tag: 'kuliah'});
eq(T.parse('just text', 'work'), {text: 'just text', done: false, tag: 'work'});
eq(T.parse('#only'), {text: '#only', done: false, tag: 'only'});
eq(T.clean([{text: 'a'}, null, {text: 3}, 'x']), [{text: 'a'}]);
eq(T.clean({}), []);
const list = [{text: 'a', tag: 'work'}, {text: 'b'}, {text: 'c', tag: 'home'}, {text: 'd', tag: 'work'}];
eq(T.tags(list), ['home', 'work']);
eq(T.visible(list, 'work').map(t => t.text), ['a', 'd']);
eq(T.visible(list, null).length, 4);
const doneList = [{text: 'a', tag: 'work', done: true}, {text: 'b', done: true}, {text: 'c', tag: 'home', done: true}, {text: 'd', tag: 'work'}];
eq(T.clearDone(doneList, 'work').map(t => t.text), ['b', 'c', 'd']); // only the category's done ones go
eq(T.clearDone(doneList, null).map(t => t.text), ['d']);

// Deadlines (local time).
const now = new Date(2026, 10, 2, 10, 0).getTime();
const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
eq(T.parse('report #work @14:30', null, now), {text: 'report', done: false, tag: 'work', due: at(2, 14, 30)});
eq(T.parse('@tomorrow 9:05 call', null, now).due, at(3, 9, 5));
eq(T.parse('pay @2026-11-05', null, now).due, at(5, 23, 59));
eq(T.parse('pay @2026-11-05 17:00 rent', null, now), {text: 'pay rent', done: false, due: at(5, 17, 0)});
eq(T.parse('mail me@home.com', null, now), {text: 'mail me@home.com', done: false}); // not a deadline
eq(T.parse('late @25:00', null, now).due, undefined);
eq(T.parse('x', T.OVERDUE), {text: 'x', done: false}); // the Overdue filter isn't a category
const t = {text: 'pay rent', done: false, tag: 'home', due: at(5, 17, 0)};
eq(T.format(t), 'pay rent #home @2026-11-05 17:00');
eq(T.parse(T.format(t), null, now), t);
eq(T.edit({...t, reason: 'no cash'}, 'pay all rent #home @2026-11-05 17:00', now).reason, 'no cash');
eq(T.edit({...t, reason: 'no cash', done: true}, 'pay rent @2026-11-06', now), {text: 'pay rent', done: true, due: at(6, 23, 59)});
eq(T.dueLabel(at(2, 14, 30), now), '14:30');
eq(T.dueLabel(at(5, 9, 0), now), '5 Nov 09:00');
const ts = [{text: 'a', due: at(1, 9, 0), tag: 'w'}, {text: 'b', due: at(1, 8, 0), reason: 'busy'},
    {text: 'c', due: at(1, 7, 0), done: true}, {text: 'd', due: at(4, 9, 0)}, {text: 'e', due: at(3, 9, 0), reason: 'x'}, {text: 'f'}];
eq(T.visible(ts, T.OVERDUE, now).map(x => x.text), ['a', 'b']);
eq(T.alerts(ts, now).map(x => x.text), ['a']);
eq(T.nextDue(ts, now), at(4, 9, 0));
eq(T.nextDue([], now), null);
print('tasks: ok');
