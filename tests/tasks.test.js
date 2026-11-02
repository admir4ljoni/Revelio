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
print('tasks: ok');
