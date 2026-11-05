// Money tracking logic for the Money tab and its Excel report. Pure: no Shell imports.
// An entry is {kind, amount, wallet, date, note?, category?, month?, to?, pocket?}:
//   kind 'in' (money added), 'out' (spent), 'move' (between wallets, `wallet` -> `to`),
//   'save' (wallet -> pocket) or 'withdraw' (pocket -> wallet); `pocket` is the pocket's id
//   amount in whole rupiah; wallet 'cash' | 'ewallet'; date 'YYYY-MM-DD'
//   category (out): lower-case tag; month (in): 'YYYY-MM' the money is budgeted for.
// Months run from the 1st. Whatever a month doesn't spend (or overspends) carries into the next.
// The plan (money-plan.json) is {setAsides: [{tag, amount}], pockets: [{id, name, target, due?}]}:
// a set-aside reserves `amount` of every month's money for one category; a pocket is a savings jar
// with a target (and a 'YYYY-MM-DD' date to use it by). Money in a pocket is out of the wallets and
// out of the month's money until it's taken back.
import {parse as parseTag} from './tasks.js';

export const WALLETS = {cash: 'Cash', ewallet: 'E-wallet'};
export const PRESETS = ['food', 'transport', 'health', 'bills', 'shopping', 'fun', 'other'];
// Fixed costs: they shrink the month's money but don't count against today or the spending pace
// (rent paid today isn't today's spending; untracked money went missing over earlier days).
export const FIXED = ['bills', 'untracked'];
export const LATE_DAY = 25; // money added from this day on counts for next month by default
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

const pad = n => String(n).padStart(2, '0');
const ym = month => month.split('-').map(Number);
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (date, n) => {
    const [y, m, d] = date.split('-').map(Number);
    return iso(new Date(y, m - 1, d + n));
};
export const addMonths = (month, n) => {
    const [y, m] = ym(month);
    return iso(new Date(y, m - 1 + n, 1)).slice(0, 7);
};
export const daysIn = month => {
    const [y, m] = ym(month);
    return new Date(y, m, 0).getDate();
};
export const monthName = (month, short = false) => {
    const [y, m] = ym(month);
    return `${short ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]} ${y}`;
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// 'Today', 'Yesterday', else 'Fri 30 Oct' (with the year when it isn't this year's).
export function dayLabel(date, today) {
    if (date === today)
        return 'Today';
    if (date === addDays(today, -1))
        return 'Yesterday';
    const [y, m, d] = date.split('-').map(Number);
    return `${DAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1].slice(0, 3)}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`}`;
}
export const monthOf = e => (e.kind === 'in' && e.month ? e.month : e.date.slice(0, 7));
export const defaultMonth = date => (Number(date.slice(8)) >= LATE_DAY ? addMonths(date.slice(0, 7), 1) : date.slice(0, 7));
export const label = tag => tag[0].toUpperCase() + tag.slice(1);
export const pct = x => `${Math.round(x * 100)}%`;

export function idr(n) {
    const digits = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${n < 0 ? '-' : ''}Rp ${digits}`;
}

// "25000", "25.000", "Rp25.000", "25k", "25rb", "1.5jt", "1,5jt", "2m" -> whole rupiah, else null.
const UNITS = {k: 1e3, rb: 1e3, jt: 1e6, m: 1e6};
export function parseAmount(s) {
    const m = s.trim().toLowerCase().match(/^(?:rp\.?\s?)?(\d[\d.,]*)(k|rb|jt|m)?$/);
    if (!m)
        return null;
    const n = m[2] ? Number(m[1].replace(',', '.')) * UNITS[m[2]] : Number(m[1].replace(/[.,]/g, ''));
    return Number.isFinite(n) && Math.round(n) > 0 ? Math.round(n) : null;
}

// "25k lunch #food" -> {amount: 25000, note: 'lunch', tag: 'food'}. The first word that reads as an
// amount is the amount; amount is null when there's none.
// `due` ('YYYY-MM-DD', only when given) from "@2027-06-01" or "@tomorrow", for a pocket's date.
export function parseEntry(input, fallbackTag = null) {
    const {text, tag, due} = parseTag(input, fallbackTag);
    const words = text.split(' ').filter(Boolean);
    const i = words.findIndex(w => parseAmount(w) !== null);
    const amount = i < 0 ? null : parseAmount(words[i]);
    const note = words.filter((_w, j) => j !== i).join(' ').replace(/^#\S+$/, '');
    return {amount, note, tag: tag ?? null, ...due ? {due: iso(new Date(due))} : {}};
}

// Valid entries from whatever was on disk.
export const clean = data => (Array.isArray(data) ? data.filter(e => e && ['in', 'out', 'move', 'save', 'withdraw'].includes(e.kind) &&
    Number.isInteger(e.amount) && e.amount > 0 && e.wallet in WALLETS && /^\d{4}-\d\d-\d\d$/.test(e.date) &&
    (e.kind !== 'move' || (e.to in WALLETS && e.to !== e.wallet)) &&
    (!['save', 'withdraw'].includes(e.kind) || typeof e.pocket === 'string')) : []);

const amountOk = n => Number.isInteger(n) && n > 0;
export const cleanPlan = d => ({
    setAsides: (Array.isArray(d?.setAsides) ? d.setAsides : []).filter(a => typeof a?.tag === 'string' && amountOk(a.amount)),
    pockets: (Array.isArray(d?.pockets) ? d.pockets : []).filter(p => typeof p?.id === 'string' &&
        typeof p.name === 'string' && amountOk(p.target)),
});

// Money in pocket `id` (every pocket's, without one).
export const pocketBalance = (entries, id = null) => entries.reduce((n, e) => n +
    ((id === null ? e.pocket !== undefined : e.pocket === id) ? {save: e.amount, withdraw: -e.amount}[e.kind] ?? 0 : 0), 0);

// A pocket's progress, and what it still needs each month (this one included) to make its date.
export function pocketPlan(entries, pocket, date) {
    const saved = pocketBalance(entries, pocket.id), need = Math.max(0, pocket.target - saved);
    const [y, m] = ym(date), [dy, dm] = pocket.due ? ym(pocket.due) : [0, 0];
    const months = (dy - y) * 12 + dm - m + 1;
    return {saved, need, used: Math.min(1, saved / pocket.target),
        perMonth: pocket.due && need > 0 ? need / Math.max(1, months) : null};
}

// Each set-aside this month: what's been spent in its category, what's left of it, how far over.
export function reserves(entries, month, setAsides) {
    return setAsides.map(({tag, amount}) => {
        const spent = entries.reduce((n, e) => n +
            (e.kind === 'out' && monthOf(e) === month && (e.category || 'other') === tag ? e.amount : 0), 0);
        return {tag, amount, spent, left: Math.max(0, amount - spent), over: Math.max(0, spent - amount)};
    });
}

// Money held in each wallet, from every entry (dated up to `upTo`, if given).
export function balances(entries, upTo = null) {
    const b = {cash: 0, ewallet: 0};
    for (const e of entries) {
        if (upTo && e.date > upTo)
            continue;
        b[e.wallet] += e.kind === 'in' || e.kind === 'withdraw' ? e.amount : -e.amount;
        if (e.kind === 'move')
            b[e.to] += e.amount;
    }
    return b;
}

export function summary(entries, month) {
    let carry = 0, income = 0, spent = 0, fixed = 0, saved = 0;
    const cats = new Map();
    for (const e of entries) {
        if (e.kind === 'move')
            continue;
        const m = monthOf(e), sign = e.kind === 'in' || e.kind === 'withdraw' ? 1 : -1;
        if (m < month) {
            carry += sign * e.amount;
        } else if (m === month && (e.kind === 'save' || e.kind === 'withdraw')) {
            saved -= sign * e.amount; // net put into pockets
        } else if (m === month && e.kind === 'in') {
            income += e.amount;
        } else if (m === month) {
            spent += e.amount;
            const c = e.category || 'other';
            if (FIXED.includes(c))
                fixed += e.amount;
            cats.set(c, (cats.get(c) ?? 0) + e.amount);
        }
    }
    const budget = carry + income - saved;
    return {
        month, carry, income, saved, budget, spent, fixed,
        left: budget - spent,
        used: budget > 0 ? spent / budget : null, // null: nothing to spend from
        categories: [...cats].sort((a, b) => b[1] - a[1]).map(([tag, amount]) => ({tag, amount})),
    };
}

// The month so far, plus what today can take so the rest of the month gets the same each day.
// Set-asides are planned costs: what's left of them is held back (`reserved`, leaving `free`), and
// spending inside one isn't day-to-day; only what goes past it is. `daily`: day-to-day spending
// (all but fixed costs and set-asides); `paceUsed`: its share of the day-to-day money (`pool`).
export function today(entries, date, setAsides = []) {
    const s = summary(entries, date.slice(0, 7));
    const day = Number(date.slice(8)), days = daysIn(s.month);
    const r = reserves(entries, s.month, setAsides), planned = new Map(r.map(x => [x.tag, x]));
    const catSpent = new Map(s.categories.map(c => [c.tag, c.amount]));
    let spentToday = 0;
    const todayIn = new Map();
    for (const e of entries) {
        const c = e.category || 'other';
        if (e.kind !== 'out' || e.date !== date || FIXED.includes(c))
            continue;
        if (planned.has(c))
            todayIn.set(c, (todayIn.get(c) ?? 0) + e.amount);
        else
            spentToday += e.amount;
    }
    let plannedCost = 0, plannedSpent = 0;
    for (const tag of new Set([...FIXED, ...planned.keys()])) {
        const spent = catSpent.get(tag) ?? 0, cap = planned.get(tag)?.amount ?? 0;
        if (FIXED.includes(tag)) {
            plannedCost += Math.max(spent, cap);
            plannedSpent += spent;
        } else {
            plannedCost += cap;
            plannedSpent += Math.min(spent, cap);
            spentToday += Math.min(todayIn.get(tag) ?? 0, planned.get(tag).over); // past the set-aside today
        }
    }
    // `available`: the month's money minus every set-aside; `free` is what's left of it.
    const reserved = r.reduce((n, x) => n + x.left, 0), free = s.left - reserved;
    const available = s.budget - r.reduce((n, x) => n + x.amount, 0);
    const perDay = (free + spentToday) / (days - day + 1);
    const pool = s.budget - plannedCost, daily = s.spent - plannedSpent;
    return {...s, day, days, pace: day / days, reserves: r, reserved, free, available,
        freeUsed: available > 0 ? 1 - free / available : null, spentToday, perDay,
        todayLeft: perDay - spentToday, daily, pool, paceUsed: pool > 0 ? daily / pool : null};
}

// One wallet this month: what's in it now, what's been spent from it, and the share spent of the
// wallet's money (spent ÷ (now + spent), so moves in and out count). perDay spreads what's in it
// over the days left, today included.
export function walletMonth(entries, wallet, date) {
    const month = date.slice(0, 7), left = balances(entries, date)[wallet];
    const spent = entries.reduce((n, e) => n +
        (e.kind === 'out' && e.wallet === wallet && e.date.startsWith(month) && e.date <= date ? e.amount : 0), 0);
    const pool = left + spent, day = Number(date.slice(8)), days = daysIn(month);
    return {wallet, month, left, spent, used: pool > 0 ? spent / pool : null, pace: day / days,
        perDay: left / (days - day + 1)};
}

// Up to two short pieces of advice for the month so far, most urgent first.
export function tips(entries, date, setAsides = []) {
    const t = today(entries, date, setAsides);
    if (t.budget <= 0 && !t.spent)
        return ['Add this month’s money with + Money to see your budget.'];
    const out = [], pace = t.pace, daily = t.daily;
    if (t.left < 0)
        out.push(`Over by ${idr(-t.left)}; it comes out of next month.`);
    else if (t.free < 0)
        out.push(`Set-asides need ${idr(-t.free)} more than is left this month.`);
    else if (t.paceUsed !== null && t.paceUsed > pace + 0.1)
        out.push(`${pct(t.paceUsed)} of day-to-day money spent, ${pct(pace)} of the month gone. Keep to ${idr(t.perDay)} a day.`);
    const over = t.reserves.filter(x => x.over > 0).sort((a, b) => b.over - a.over)[0];
    if (over)
        out.push(`${label(over.tag)} is ${idr(over.over)} past its ${idr(over.amount)} set-aside.`);
    const untracked = t.categories.find(c => c.tag === 'untracked');
    if (untracked && untracked.amount >= 0.15 * t.spent)
        out.push(`${idr(untracked.amount)} is untracked. Logging as you spend sharpens these tips.`);
    const dayToDay = t.categories.filter(c => !FIXED.includes(c.tag) && !t.reserves.some(x => x.tag === c.tag)), top = dayToDay[0];
    if (top && dayToDay.length > 1 && top.amount >= 0.4 * daily) {
        const prev = summary(entries, addMonths(t.month, -1));
        const before = prev.categories.find(c => c.tag === top.tag);
        out.push(`${label(top.tag)} is ${pct(top.amount / daily)} of your day-to-day spending` +
            `${before ? ` (${pct(before.amount / (prev.spent - prev.fixed))} last month)` : ''}.`);
    }
    if (!out.length && t.left >= 0 && daily > 0) {
        const end = t.pool - daily / pace; // left at month end if day-to-day spending keeps this pace
        out.push(end > 0 ? `On track: about ${idr(end)} left at the end of the month.`
            : `At this pace the money runs out before the month ends. Aim for ${idr(t.perDay)} a day.`);
    }
    return out.slice(0, 2);
}

// --- Excel report: one sheet per month, newest first, rebuilt from all entries each time ---

// Categorical slots (validated palette order), fixed per category so a colour always means the same
// thing; untracked is neutral grey, custom tags share the last slot.
const SLOTS = ['2A78D6', 'EB6834', '1BAF7A', 'EDA100', 'E87BA4', '008300', '6250D6', 'E34948'];
const catColor = tag => (tag === 'untracked' ? '8C959F' : SLOTS[PRESETS.includes(tag) ? PRESETS.indexOf(tag) : 7]);
const INK = '1F2328', MUTED = '57606A', CARD = 'F6F8FA', HEAD = '24292F', BAND = 'F6F8FA';
// Rupiah (Indonesian currency code 421). Thousands separators follow the viewer's locale.
const MONEY = '[$Rp-421] #,##0;-[$Rp-421] #,##0';
const serial = date => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 864e5 + 25569; // days since 1899-12-30
};
const KIND = {in: 'Income', out: 'Spent', move: 'Move', save: 'To pocket', withdraw: 'From pocket'};

export function reportMonths(entries) {
    return [...new Set(entries.map(monthOf))].sort().reverse();
}

export function reportSheet(entries, month, now) {
    const s = summary(entries, month), name = monthName(month, true), q = `'${name}'`;
    const end = `${month}-${pad(daysIn(month))}`, b = balances(entries, end);
    const cells = [], put = (ref, v, st) => cells.push([ref, v, st]);
    const cap = {size: 9, color: MUTED, fill: CARD, indent: 1};
    const value = {size: 14, bold: true, color: INK, fill: CARD, fmt: MONEY, indent: 1, align: 'left'};
    const head = {bold: true, color: 'FFFFFF', fill: HEAD, indent: 1};
    const headNum = {...head, align: 'right'};
    const section = {bold: true, size: 12, color: INK, border: 'bottom'};

    put('A1', monthName(month), {bold: true, size: 20, color: INK});
    put('A2', `Money report · generated ${now.getDate()} ${MONTHS[now.getMonth()].slice(0, 3)} ${now.getFullYear()}, ` +
        `${pad(now.getHours())}:${pad(now.getMinutes())}`, {size: 9, color: MUTED});
    const kpis = [['Income', s.income], ['Carried over', s.carry], ['Total to spend', s.budget], ['Spent', s.spent],
        ['Left', s.left], ['Used', s.used ?? 0]];
    kpis.forEach(([text, v], i) => {
        const col = 'ABCDEF'[i];
        put(`${col}4`, text, cap);
        put(`${col}5`, v, text === 'Used' ? {...value, fmt: '0%'}
            : text === 'Left' ? {...value, color: s.left < 0 ? 'B42318' : '1A7F37'} : value);
    });
    [['Cash at month end', b.cash], ['E-wallet at month end', b.ewallet], ['Fixed costs', s.fixed], ['Day-to-day', s.spent - s.fixed]]
        .forEach(([text, v], i) => {
            put(`${'ABCD'[i]}7`, text, cap);
            put(`${'ABCD'[i]}8`, v, {...value, size: 12});
        });

    // Spending by category (feeds the doughnut).
    let r = 10;
    put(`A${r}`, 'Spending by category', section);
    put(`B${r}`, '', section);
    put(`C${r}`, '', section);
    r++;
    ['Category', 'Amount', 'Share'].forEach((h, i) => put(`${'ABC'[i]}${r}`, h, i ? headNum : head));
    const catStart = r + 1;
    for (const [i, c] of s.categories.entries()) {
        r++;
        const fill = i % 2 ? BAND : undefined;
        put(`A${r}`, label(c.tag), {indent: 1, fill});
        put(`B${r}`, c.amount, {fmt: MONEY, fill});
        put(`C${r}`, c.amount / s.spent, {fmt: '0%', fill, color: MUTED});
    }
    const catEnd = r;
    r++;
    put(`A${r}`, 'Total', {bold: true, border: 'top', indent: 1});
    put(`B${r}`, s.spent, {bold: true, border: 'top', fmt: MONEY});
    put(`C${r}`, s.spent ? 1 : 0, {bold: true, border: 'top', fmt: '0%'});

    // Every entry of the month, oldest first.
    r += 3;
    put(`A${r}`, 'All entries', section);
    'BCDEF'.split('').forEach(col => put(`${col}${r}`, '', section));
    r++;
    ['Date', 'Type', 'Category', 'Wallet', 'Amount', 'Note'].forEach((h, i) => put(`${'ABCDEF'[i]}${r}`, h, i === 4 ? headNum : i === 5 ? {...head, indent: 2} : head));
    const list = entries.filter(e => monthOf(e) === month).sort((x, y) => x.date.localeCompare(y.date));
    for (const [i, e] of list.entries()) {
        r++;
        const fill = i % 2 ? BAND : undefined;
        const color = {in: '1A7F37', out: 'B42318', move: MUTED, save: MUTED, withdraw: MUTED}[e.kind];
        put(`A${r}`, serial(e.date), {fmt: 'd mmm yyyy', fill, indent: 1, align: 'left'});
        put(`B${r}`, KIND[e.kind], {fill, color});
        put(`C${r}`, e.kind === 'out' ? label(e.category || 'other') : '', {fill});
        put(`D${r}`, e.kind === 'move' ? `${WALLETS[e.wallet]} → ${WALLETS[e.to]}` : WALLETS[e.wallet], {fill});
        put(`E${r}`, e.kind === 'out' || e.kind === 'save' ? -e.amount : e.amount, {fmt: MONEY, fill, color, bold: true});
        put(`F${r}`, e.note ?? '', {fill, color: MUTED, indent: 2});
    }
    if (!list.length)
        put(`A${r + 1}`, 'Nothing logged', {color: MUTED, italic: true, indent: 1});

    // Day by day (feeds the line chart): spent so far against an even pace through the month.
    const days = daysIn(month), today = iso(now), dayStart = 11;
    put('Q10', 'Day by day', section);
    put('R10', '', section);
    put('S10', '', section);
    ['Day', 'Spent so far', 'Even pace'].forEach((h, i) => put(`${'QRS'[i]}11`, h, i ? headNum : {...head, align: 'center'}));
    const spentSoFar = [], pace = [];
    let total = 0;
    for (let d = 1; d <= days; d++) {
        const date = `${month}-${pad(d)}`;
        total += list.reduce((n, e) => n + (e.kind === 'out' && e.date === date ? e.amount : 0), 0);
        const row = dayStart + d, fill = d % 2 ? undefined : BAND;
        spentSoFar.push(date <= today ? total : null);
        pace.push(Math.round(s.budget * d / days));
        put(`Q${row}`, d, {fill, align: 'center'});
        put(`R${row}`, spentSoFar.at(-1), {fmt: MONEY, fill});
        put(`S${row}`, pace.at(-1), {fmt: MONEY, fill, color: MUTED});
    }

    const ref = (col, a, z) => `${q}!$${col}$${a}:$${col}$${z}`;
    const charts = [];
    if (s.categories.length) {
        charts.push({type: 'doughnut', title: 'Where the money went', from: 'H4', to: 'O21',
            cats: {ref: ref('A', catStart, catEnd), values: s.categories.map(c => label(c.tag))},
            series: [{name: 'Spent', ref: ref('B', catStart, catEnd), values: s.categories.map(c => c.amount)}],
            colors: s.categories.map(c => catColor(c.tag))});
    }
    charts.push({type: 'line', title: 'Spent so far vs. even pace', from: 'H23', to: 'O40',
        axisFormat: '[>=1000000]0.0,,"jt";[>=1000]0,"rb";0',
        cats: {ref: ref('Q', dayStart + 1, dayStart + days), values: Array.from({length: days}, (_v, i) => String(i + 1))},
        series: [{name: 'Spent so far', ref: ref('R', dayStart + 1, dayStart + days), values: spentSoFar, color: SLOTS[0]},
            {name: 'Even pace', ref: ref('S', dayStart + 1, dayStart + days), values: pace, color: '8C959F', dash: true}]});

    return {
        name, cells, charts,
        cols: [18, 17, 17, 20, 17, 30, 3, 9, 9, 9, 9, 9, 9, 9, 9, 3, 7, 15, 15],
        heights: {1: 34, 2: 16, 4: 18, 5: 28, 7: 18, 8: 24},
        merges: ['A1:F1', 'A2:F2'],
    };
}


// All months, newest first (so the workbook opens on the latest).
export const reportSheets = (entries, now) => reportMonths(entries).map(m => reportSheet(entries, m, now));
