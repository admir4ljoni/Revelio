// gjs -m tests/money.test.js
import * as M from '../src/lib/money.js';

const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

eq(M.idr(1250000), 'Rp 1.250.000');
eq(M.idr(-25000), '-Rp 25.000');
eq(M.idr(0), 'Rp 0');
eq(['25000', '25.000', 'Rp25.000', 'rp 25.000', '25k', '25rb', '25K'].map(M.parseAmount), Array(7).fill(25000));
eq(['1.5jt', '1,5jt', '1.5m', '1500000'].map(M.parseAmount), Array(4).fill(1500000));
eq(['', 'abc', '0', 'k', '-5', '1.2.3jt'].map(M.parseAmount), Array(6).fill(null));
eq(M.parseEntry('25k lunch #Food'), {amount: 25000, note: 'lunch', tag: 'food'});
eq(M.parseEntry('nasi padang 18.000'), {amount: 18000, note: 'nasi padang', tag: null});
eq(M.parseEntry('grab', 'transport'), {amount: null, note: 'grab', tag: 'transport'});
eq(M.parseEntry('5jt #salary'), {amount: 5000000, note: '', tag: 'salary'});
eq(M.addMonths('2026-12', 1), '2027-01');
eq(M.addMonths('2026-01', -1), '2025-12');
eq(M.addDays('2026-11-01', -1), '2026-10-31');
eq(M.daysIn('2028-02'), 29);
eq(M.defaultMonth('2026-11-24'), '2026-11');
eq(M.defaultMonth('2026-12-27'), '2027-01'); // late salary counts for next month
eq(M.monthName('2026-11'), 'November 2026');
eq(M.clean([{kind: 'in', amount: 5, wallet: 'cash', date: '2026-11-01'}, {kind: 'out', amount: 1.5, wallet: 'cash', date: '2026-11-01'},
    {kind: 'move', amount: 5, wallet: 'cash', to: 'cash', date: '2026-11-01'}, null, {kind: 'x'}]).length, 1);

// October: salary on the 28th counts for November; October overspends by 100k on the 30th.
const e = [
    {kind: 'in', amount: 3000000, wallet: 'ewallet', date: '2026-10-01'},
    {kind: 'out', amount: 2900000, wallet: 'ewallet', date: '2026-10-20', category: 'bills'},
    {kind: 'in', amount: 5000000, wallet: 'ewallet', date: '2026-10-28', month: '2026-11'},
    {kind: 'out', amount: 200000, wallet: 'ewallet', date: '2026-10-30', category: 'food'},
    {kind: 'move', amount: 500000, wallet: 'ewallet', to: 'cash', date: '2026-11-01'},
    {kind: 'out', amount: 60000, wallet: 'cash', date: '2026-11-01', category: 'food'},
    {kind: 'out', amount: 40000, wallet: 'cash', date: '2026-11-02', category: 'transport'},
    {kind: 'out', amount: 300000, wallet: 'ewallet', date: '2026-11-02', category: 'untracked'},
];
const oct = M.summary(e, '2026-10');
eq([oct.income, oct.spent, oct.left], [3000000, 3100000, -100000]);
const nov = M.summary(e, '2026-11');
eq([nov.carry, nov.income, nov.budget, nov.spent, nov.left], [-100000, 5000000, 4900000, 400000, 4500000]);
eq(nov.categories.map(c => c.tag), ['untracked', 'food', 'transport']);
eq(M.balances(e), {cash: 400000, ewallet: 4100000});
eq(M.balances(e, '2026-10-31'), {cash: 0, ewallet: 4900000});
eq(M.balances(e).cash + M.balances(e).ewallet, 3000000 + 5000000 - 3500000); // moves don't change the total

const t = M.today(e, '2026-11-02');
eq([t.day, t.days, t.spentToday], [2, 30, 40000]); // the recount's untracked isn't today's
eq(Math.round(t.perDay), Math.round((4500000 + 40000) / 29));
eq(Math.round(t.todayLeft), Math.round(t.perDay - 40000));
eq(M.tips(e, '2026-11-02')[1], 'Food is 60% of your day-to-day spending (100% last month).');
eq(M.tips(e, '2026-11-02')[0].startsWith('Rp 300.000 is untracked'), true);
eq(M.tips([], '2026-11-02'), ['Add this month’s money with + Money to see your budget.']);
eq(M.tips(e, '2026-10-30')[0], 'Over by Rp 100.000; it comes out of next month.');
// Spent 50% by day 5 of 30: ahead of pace.
const fast = [{kind: 'in', amount: 1000000, wallet: 'cash', date: '2026-11-01'},
    {kind: 'out', amount: 500000, wallet: 'cash', date: '2026-11-03', category: 'food'}];
eq(M.tips(fast, '2026-11-05')[0].startsWith('50% of day-to-day money spent, 17% of the month gone'), true);
// Rent paid today is a fixed cost: it lowers the allowance but isn't today's spending or ahead of pace.
const rent = [{kind: 'in', amount: 3000000, wallet: 'cash', date: '2026-11-01'},
    {kind: 'out', amount: 1500000, wallet: 'cash', date: '2026-11-02', category: 'bills'},
    {kind: 'out', amount: 20000, wallet: 'cash', date: '2026-11-02', category: 'food'}];
const r = M.today(rent, '2026-11-02');
eq([r.spentToday, Math.round(r.todayLeft), r.fixed], [20000, Math.round(1500000 / 29) - 20000, 1500000]);
eq(M.tips(rent, '2026-11-02')[0].startsWith('On track'), true);
// Food leads day-to-day spending: compared with last month.
const food = [{kind: 'in', amount: 3000000, wallet: 'cash', date: '2026-10-01'},
    {kind: 'out', amount: 100000, wallet: 'cash', date: '2026-10-05', category: 'food'},
    {kind: 'out', amount: 300000, wallet: 'cash', date: '2026-10-06', category: 'fun'},
    {kind: 'out', amount: 300000, wallet: 'cash', date: '2026-11-05', category: 'food'},
    {kind: 'out', amount: 100000, wallet: 'cash', date: '2026-11-06', category: 'fun'},
    {kind: 'out', amount: 900000, wallet: 'cash', date: '2026-11-06', category: 'bills'}];
eq(M.tips(food, '2026-11-15'), ['Food is 75% of your day-to-day spending (25% last month).']);
const slow = [{kind: 'in', amount: 3000000, wallet: 'cash', date: '2026-11-01'},
    {kind: 'out', amount: 100000, wallet: 'cash', date: '2026-11-10', category: 'food'}];
eq(M.tips(slow, '2026-11-10'), ['On track: about Rp 2.700.000 left at the end of the month.']);
print('money: ok');
