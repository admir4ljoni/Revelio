// Money tracking logic for the Money tab and its Excel report. Pure: no Shell imports.
// An entry is {kind, amount, wallet, date, note?, category?, month?, to?}:
//   kind 'in' (money added), 'out' (spent) or 'move' (between wallets, `wallet` -> `to`)
//   amount in whole rupiah; wallet 'cash' | 'ewallet'; date 'YYYY-MM-DD'
//   category (out): lower-case tag; month (in): 'YYYY-MM' the money is budgeted for.
// Months run from the 1st. Whatever a month doesn't spend (or overspends) carries into the next.
import {parse as parseTag} from './tasks.js';

export const WALLETS = {cash: 'Cash', ewallet: 'E-wallet'};
export const PRESETS = ['food', 'transport', 'health', 'bills', 'shopping', 'fun', 'other'];
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
export function parseEntry(input, fallbackTag = null) {
    const {text, tag} = parseTag(input, fallbackTag);
    const words = text.split(' ').filter(Boolean);
    const i = words.findIndex(w => parseAmount(w) !== null);
    const amount = i < 0 ? null : parseAmount(words[i]);
    const note = words.filter((_w, j) => j !== i).join(' ').replace(/^#\S+$/, '');
    return {amount, note, tag: tag ?? null};
}

// Valid entries from whatever was on disk.
export const clean = data => (Array.isArray(data) ? data.filter(e => e && ['in', 'out', 'move'].includes(e.kind) &&
    Number.isInteger(e.amount) && e.amount > 0 && e.wallet in WALLETS && /^\d{4}-\d\d-\d\d$/.test(e.date) &&
    (e.kind !== 'move' || (e.to in WALLETS && e.to !== e.wallet))) : []);

// Money held in each wallet, from every entry (dated up to `upTo`, if given).
export function balances(entries, upTo = null) {
    const b = {cash: 0, ewallet: 0};
    for (const e of entries) {
        if (upTo && e.date > upTo)
            continue;
        b[e.wallet] += e.kind === 'in' ? e.amount : -e.amount;
        if (e.kind === 'move')
            b[e.to] += e.amount;
    }
    return b;
}

export function summary(entries, month) {
    let carry = 0, income = 0, spent = 0;
    const cats = new Map();
    for (const e of entries) {
        if (e.kind === 'move')
            continue;
        const m = monthOf(e), sign = e.kind === 'in' ? 1 : -1;
        if (m < month) {
            carry += sign * e.amount;
        } else if (m === month && e.kind === 'in') {
            income += e.amount;
        } else if (m === month) {
            spent += e.amount;
            const c = e.category || 'other';
            cats.set(c, (cats.get(c) ?? 0) + e.amount);
        }
    }
    const budget = carry + income;
    return {
        month, carry, income, budget, spent,
        left: budget - spent,
        used: budget > 0 ? spent / budget : null, // null: nothing to spend from
        categories: [...cats].sort((a, b) => b[1] - a[1]).map(([tag, amount]) => ({tag, amount})),
    };
}

// The month so far, plus what today can take so the rest of the month gets the same each day.
// Untracked (from a recount) was spent on earlier days, so it doesn't eat into today.
export function today(entries, date) {
    const s = summary(entries, date.slice(0, 7));
    const day = Number(date.slice(8)), days = daysIn(s.month);
    const spentToday = entries.reduce((n, e) => n +
        (e.kind === 'out' && e.date === date && e.category !== 'untracked' ? e.amount : 0), 0);
    const perDay = (s.left + spentToday) / (days - day + 1);
    return {...s, day, days, spentToday, perDay, todayLeft: perDay - spentToday};
}

// Up to two short pieces of advice for the month so far, most urgent first.
export function tips(entries, date) {
    const t = today(entries, date);
    if (t.budget <= 0 && !t.spent)
        return ['Add this month’s money with + Money to see your budget.'];
    const out = [];
    const pace = t.day / t.days;
    if (t.left < 0)
        out.push(`Over by ${idr(-t.left)}; it comes out of next month.`);
    else if (t.used !== null && t.used > pace + 0.1)
        out.push(`${pct(t.used)} spent, ${pct(pace)} of the month gone. Keep to ${idr(t.perDay)} a day.`);
    const untracked = t.categories.find(c => c.tag === 'untracked');
    if (untracked && untracked.amount >= 0.15 * t.spent)
        out.push(`${idr(untracked.amount)} is untracked. Logging as you spend sharpens these tips.`);
    const top = t.categories[0];
    if (top && t.categories.length > 1 && top.tag !== 'untracked' && top.amount >= 0.4 * t.spent) {
        const prev = summary(entries, addMonths(t.month, -1));
        const before = prev.categories.find(c => c.tag === top.tag);
        out.push(`${label(top.tag)} is ${pct(top.amount / t.spent)} of your spending` +
            `${before ? ` (${pct(before.amount / prev.spent)} last month)` : ''}.`);
    }
    if (!out.length && t.left >= 0 && t.spent) {
        const end = t.budget - t.spent / pace; // left at month end if spending keeps this pace
        out.push(end > 0 ? `On track: about ${idr(end)} left at the end of the month.`
            : `At this pace the money runs out before the month ends. Aim for ${idr(t.perDay)} a day.`);
    }
    return out.slice(0, 2);
}
