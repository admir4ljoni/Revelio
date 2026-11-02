// Task list logic shared by the Tasks tab and the Tasks window. Pure: no Shell or Gtk imports.
// A task is {text, done, tag?, due?, reason?}; `tag` is a category, lower-case, without the '#';
// `due` a deadline in ms; `reason` why its deadline alert was declined (it stays open, overdue).

const TAG = /(^|\s)#([\p{L}\p{N}_-]+)/u;
// "@14:30", "@today", "@tomorrow 9:00", "@2026-11-05", "@2026-11-05 17:00". A date alone is due at 23:59.
const DUE = /(^|\s)@(?:(today|tomorrow|\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?|(\d{1,2}):(\d{2}))(?=\s|$)/i;

// The Overdue filter. Not a valid #tag, so it can't clash with one.
export const OVERDUE = ':overdue';

const pad = n => String(n).padStart(2, '0');

function parseDue(m, now) {
    const [, , day, h1, m1, h2, m2] = m;
    const d = new Date(now);
    const word = day?.toLowerCase();
    if (word === 'tomorrow')
        d.setDate(d.getDate() + 1);
    else if (day && word !== 'today')
        d.setFullYear(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
    const [h, min] = h2 ? [h2, m2] : h1 ? [h1, m1] : [23, 59];
    d.setHours(+h, +min, 0, 0);
    return Number.isNaN(d.getTime()) || +h > 23 || +min > 59 ? null : d.getTime();
}

// "call Ana #work @tomorrow 9:00" -> {text: 'call Ana', tag: 'work', due: …}. The first #tag wins;
// without one the task goes in `fallbackTag` (the category being looked at), if any.
export function parse(input, fallbackTag = null, now = Date.now()) {
    const d = input.match(DUE);
    const due = d ? parseDue(d, now) : null;
    if (d)
        input = input.replace(DUE, '$1');
    const m = input.match(TAG);
    const tag = m ? m[2].toLowerCase() : fallbackTag === OVERDUE ? null : fallbackTag;
    const text = (m ? input.replace(TAG, '$1') : input).replace(/\s+/g, ' ').trim();
    return {text: text || (m ? `#${m[2]}` : ''), done: false, ...tag ? {tag} : {}, ...due ? {due} : {}};
}

// Back to what parse() reads, for editing.
export function format(task) {
    let s = task.text;
    if (task.tag)
        s += ` #${task.tag}`;
    if (task.due) {
        const d = new Date(task.due);
        s += ` @${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return s;
}

// `old` edited into the text `input`. A moved deadline asks again when it comes.
export function edit(old, input, now = Date.now()) {
    const t = parse(input, null, now);
    return {...t, done: !!old.done, ...t.due === old.due && old.reason ? {reason: old.reason} : {}};
}

// "14:30" today, else "5 Nov 14:30".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dueLabel(due, now = Date.now()) {
    const d = new Date(due), n = new Date(now);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === n.toDateString() ? time : `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

// Valid tasks from whatever was on disk.
export const clean = data => (Array.isArray(data) ? data.filter(t => typeof t?.text === 'string') : []);

export const tags = tasks => [...new Set(tasks.map(t => t.tag).filter(Boolean))].sort();

export const overdue = (t, now = Date.now()) => typeof t.due === 'number' && !t.done && t.due <= now;

export const visible = (tasks, tag, now = Date.now()) =>
    (tag === OVERDUE ? tasks.filter(t => overdue(t, now)) : tag ? tasks.filter(t => t.tag === tag) : tasks);

// Overdue and not answered yet: the alerts to show, oldest deadline first.
export const alerts = (tasks, now = Date.now()) =>
    tasks.filter(t => overdue(t, now) && t.reason === undefined).sort((a, b) => a.due - b.due);

// When the next unanswered deadline comes, or null.
export function nextDue(tasks, now = Date.now()) {
    const due = tasks.filter(t => !t.done && t.reason === undefined && t.due > now).map(t => t.due);
    return due.length ? Math.min(...due) : null;
}
