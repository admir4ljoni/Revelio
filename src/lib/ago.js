// Short relative time for list rows: "now", "5m", "3h", "2d". `us` is elapsed microseconds.
export function ago(us) {
    const m = Math.floor(us / 60e6);
    return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}
