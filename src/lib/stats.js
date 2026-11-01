// System stats (23, 25): parse /proc text and do the delta maths. Pure, no Shell imports.

// /proc/stat → [{total, idle}] in ticks; [0] is the whole machine, then one per core.
export function parseCpu(text) {
    return text.split('\n').filter(l => /^cpu\d* /.test(l)).map(l => {
        const v = l.trim().split(/\s+/).slice(1, 9).map(Number); // user nice system idle iowait irq softirq steal
        return {total: v.reduce((a, b) => a + b, 0), idle: v[3] + v[4]};
    });
}

// Busy fraction 0..1 per entry between two parseCpu() results.
export const cpuLoad = (prev, cur) => cur.map((c, i) => {
    const p = prev[i], dt = p ? c.total - p.total : 0;
    return dt > 0 ? Math.min(1, Math.max(0, 1 - (c.idle - p.idle) / dt)) : 0;
});

// /proc/meminfo → {total, available} in bytes.
export function parseMeminfo(text) {
    const kb = key => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024;
    return {total: kb('MemTotal'), available: kb('MemAvailable')};
}

// /proc/net/dev → {rx, tx} bytes summed over interfaces, loopback excluded.
export function parseNetDev(text) {
    let rx = 0, tx = 0;
    for (const line of text.split('\n').slice(2)) {
        const [name, rest] = line.split(':');
        if (!rest || name.trim() === 'lo')
            continue;
        const v = rest.trim().split(/\s+/).map(Number);
        rx += v[0];
        tx += v[8];
    }
    return {rx, tx};
}

// Per-second rate of a growing counter; 0 on reset or no time passed.
export const rate = (prev, cur, ms) => (ms > 0 && cur >= prev ? (cur - prev) * 1000 / ms : 0);

// Delta of a counter that wraps at `max` (RAPL energy_uj).
export const wrapDelta = (prev, cur, max) => (cur >= prev ? cur - prev : cur + max - prev);

// /proc/[pid]/stat → {name, ticks} (utime + stime). The name may hold spaces and parentheses.
export function parseProcStat(text) {
    const open = text.indexOf('('), close = text.lastIndexOf(')');
    const v = text.slice(close + 2).split(' '); // v[0] is field 3 (state)
    return {name: text.slice(open + 1, close), ticks: Number(v[11]) + Number(v[12])};
}

// Heaviest apps between two samples: prev/cur are Map pid → {name, ticks}, totalTicks the whole
// machine's tick delta. Returns [{name, share 0..1 of the machine}], same names summed.
export function topApps(prev, cur, totalTicks, n) {
    const byName = new Map();
    for (const [pid, c] of cur) {
        const p = prev.get(pid);
        if (p && p.name === c.name && c.ticks > p.ticks)
            byName.set(c.name, (byName.get(c.name) ?? 0) + c.ticks - p.ticks);
    }
    return [...byName].sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([name, t]) => ({name, share: totalTicks > 0 ? t / totalTicks : 0}));
}
