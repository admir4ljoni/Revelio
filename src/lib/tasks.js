// Task list logic shared by the Tasks tab and the Tasks window. Pure: no Shell or Gtk imports.
// A task is {text, done, tag?}; `tag` is a category, lower-case, without the '#'.

const TAG = /(^|\s)#([\p{L}\p{N}_-]+)/u;

// "call Ana #work" -> {text: 'call Ana', tag: 'work'}. The first #tag wins; without one the task
// goes in `fallbackTag` (the filter being looked at), if any.
export function parse(input, fallbackTag = null) {
    const m = input.match(TAG);
    const tag = m ? m[2].toLowerCase() : fallbackTag;
    const text = (m ? input.replace(TAG, '$1') : input).replace(/\s+/g, ' ').trim();
    return {text: text || (m ? `#${m[2]}` : ''), done: false, ...tag ? {tag} : {}};
}

// Valid tasks from whatever was on disk.
export const clean = data => (Array.isArray(data) ? data.filter(t => typeof t?.text === 'string') : []);

export const tags = tasks => [...new Set(tasks.map(t => t.tag).filter(Boolean))].sort();

export const visible = (tasks, tag) => (tag ? tasks.filter(t => t.tag === tag) : tasks);
