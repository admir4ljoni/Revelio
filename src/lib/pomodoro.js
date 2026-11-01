// Pomodoro (14, 8): focus/break cycle on wall-clock end timestamps, so it survives suspend and the
// extension being disabled on lock. Plain-object state (stored as JSON), pure functions, no Shell imports.
// state: {phase: 'focus'|'break'|'long-break', endsAt: ms or 0 when stopped, left: ms when paused or 0, done}
// durations: {focus, break, 'long-break'} in ms.

export const LONG_EVERY = 4; // every 4th break is a long one

export const initial = () => ({phase: 'focus', endsAt: 0, left: 0, done: 0});

export const running = s => s.endsAt > 0;

export const remaining = (s, d, now) => (running(s) ? Math.max(0, s.endsAt - now) : s.left || d[s.phase]);

export const start = (s, d, now) => (running(s) ? s : {...s, endsAt: now + remaining(s, d, now), left: 0});

export const pause = (s, d, now) => (running(s) ? {...s, endsAt: 0, left: remaining(s, d, now)} : s);

export const reset = s => ({...s, endsAt: 0, left: 0});

// Next phase, stopped, waiting for start (also "skip").
export function advance(s) {
    if (s.phase !== 'focus')
        return {...s, phase: 'focus', endsAt: 0, left: 0};
    const done = s.done + 1;
    return {phase: done % LONG_EVERY === 0 ? 'long-break' : 'break', endsAt: 0, left: 0, done};
}

// Advances when the running phase has ended; otherwise returns `s` unchanged.
export const tick = (s, now) => (running(s) && now >= s.endsAt ? advance(s) : s);
