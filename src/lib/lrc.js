// Synced lyrics (LRC): parse `[mm:ss.xx]text` lines and find the line at a time. No Shell imports.

const STAMP = /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

// Returns [{t: ms, text}] sorted by time. A line may carry several stamps (`[00:10.00][01:20.00]chorus`).
// Tags like `[ar:...]` and unstamped lines are skipped.
export function parse(lrc) {
    const lines = [];
    for (const raw of (lrc ?? '').split(/\r?\n/)) {
        const stamps = [...raw.matchAll(STAMP)];
        if (!stamps.length)
            continue;
        const text = raw.replace(STAMP, '').trim();
        for (const [, m, s] of stamps)
            lines.push({t: Math.round((Number(m) * 60 + Number(s.replace(':', '.'))) * 1000), text});
    }
    return lines.sort((a, b) => a.t - b.t);
}

// Index of the last line with t <= ms, or -1 before the first line.
export function lineAt(lines, ms) {
    let lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t <= ms) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}
