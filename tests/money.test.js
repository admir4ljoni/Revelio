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
eq(['2026-11-02', '2026-11-01', '2026-10-30', '2025-12-31'].map(d => M.dayLabel(d, '2026-11-02')),
    ['Today', 'Yesterday', 'Fri 30 Oct', 'Wed 31 Dec 2025']);
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
eq([t.day, t.days, t.spentToday], [2, 30, 40000]); // untracked isn't today's spending
eq(Math.round(t.perDay), Math.round((4500000 + 40000) / 29));
eq(Math.round(t.todayLeft), Math.round(t.perDay - 40000));
const cash = M.walletMonth(e, 'cash', '2026-11-02'), ew = M.walletMonth(e, 'ewallet', '2026-11-02');
eq([cash.left, cash.spent, cash.used], [400000, 100000, 0.2]); // 500k moved in, 100k spent
eq([ew.left, ew.spent, Math.round(ew.perDay)], [4100000, 300000, Math.round(4100000 / 29)]);
eq(M.walletMonth([], 'cash', '2026-11-02').used, null);
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
// Report: one sheet per month, newest first; regenerating rebuilds the same sheets (no duplicates).
const sheets = M.reportSheets(e, new Date(2026, 10, 2, 9, 5));
eq(sheets.map(x => x.name), ['Nov 2026', 'Oct 2026']);
eq(M.reportSheets(e, new Date()).map(x => x.name), ['Nov 2026', 'Oct 2026']);
const cell = (sheet, ref) => sheet.cells.find(c => c[0] === ref)?.[1];
eq([cell(sheets[0], 'A1'), cell(sheets[0], 'A5'), cell(sheets[0], 'B5'), cell(sheets[0], 'E5')], ['November 2026', 5000000, -100000, 4500000]);
eq(sheets[0].charts.map(c => c.type), ['doughnut', 'line']);
eq(sheets[0].charts[1].series[0].values.slice(0, 3), [60000, 400000, null]); // spent so far, blank after today
eq(sheets[0].cells.filter(c => /^B\d+$/.test(c[0]) && c[1] === 'Spent').length, 3);
eq(sheets[0].cells.some(c => c[1] === 'Salary'), false); // the 28 Oct salary (no note here) is listed under November
eq(sheets[0].cells.filter(c => c[1] === 'Income').length, 2); // KPI caption + the salary row
// Set-asides: 200k for transport out of a 3jt November (30 days). 50k of it spent today.
const plan = [{tag: 'transport', amount: 200000}];
const sa = [
    {kind: 'in', amount: 3000000, wallet: 'cash', date: '2026-11-01'},
    {kind: 'out', amount: 50000, wallet: 'cash', date: '2026-11-02', category: 'transport'},
    {kind: 'out', amount: 20000, wallet: 'cash', date: '2026-11-02', category: 'food'},
];
const s1 = M.today(sa, '2026-11-02', plan);
eq([s1.reserved, s1.free, s1.daily, s1.pool, s1.spentToday], [150000, 2780000, 20000, 2800000, 20000]);
eq([s1.available, s1.free], [2800000, 2780000]); // 3jt shows as 2.8jt once 200k is set aside
eq(M.today([{kind: 'in', amount: 50000, wallet: 'cash', date: '2026-11-01'}], '2026-11-02',
    [{tag: 'transport', amount: 25000}]).free, 25000); // 50k with 25k set aside for transport shows 25k
eq(s1.perDay, 2800000 / 29); // the reserve is held back; transport today isn't day-to-day
eq(M.today(sa, '2026-11-02').perDay, (2930000 + 70000) / 29); // without the plan, as before
// Past the set-aside: the 50k over is day-to-day (and today's spending).
const over = [...sa, {kind: 'out', amount: 200000, wallet: 'cash', date: '2026-11-02', category: 'transport'}];
const s2 = M.today(over, '2026-11-02', plan);
eq([s2.reserved, s2.daily, s2.spentToday], [0, 70000, 70000]);
eq(M.tips(over, '2026-11-02', plan).includes('Transport is Rp 50.000 past its Rp 200.000 set-aside.'), true);
eq(M.tips(sa, '2026-11-02', [{tag: 'fun', amount: 5000000}])[0], 'Set-asides need Rp 2.070.000 more than is left this month.');

// Pockets: 500k put in from cash, 100k taken back to the e-wallet; out of the month's money meanwhile.
const pk = [...sa,
    {kind: 'save', amount: 500000, wallet: 'cash', date: '2026-11-02', pocket: 'p1', note: 'laptop'},
    {kind: 'withdraw', amount: 100000, wallet: 'ewallet', date: '2026-11-03', pocket: 'p1', note: 'laptop'}];
eq(M.clean(pk).length, 5);
eq(M.clean([{kind: 'save', amount: 1, wallet: 'cash', date: '2026-11-02'}]), []); // no pocket
eq(M.pocketBalance(pk, 'p1'), 400000);
eq(M.pocketBalance(pk), 400000);
eq(M.balances(pk), {cash: 2430000, ewallet: 100000});
const ps = M.summary(pk, '2026-11');
eq([ps.saved, ps.budget, ps.left], [400000, 2600000, 2530000]);
eq(M.summary(pk, '2026-12').carry, 2530000); // pocket money stays out of later months
const pocket = {id: 'p1', name: 'laptop', target: 1000000, due: '2027-01-15'};
eq(M.pocketPlan(pk, pocket, '2026-11-03'), {saved: 400000, need: 600000, used: 0.4, perMonth: 200000}); // Nov, Dec, Jan
eq(M.pocketPlan(pk, {...pocket, due: undefined}, '2026-11-03').perMonth, null);
eq(M.parseEntry('laptop 5jt @2027-06-01'), {amount: 5000000, note: 'laptop', tag: null, due: '2027-06-01'});
eq(M.cleanPlan({setAsides: [{tag: 'transport', amount: 200000}, {tag: 'x', amount: -1}], pockets: [pocket, {id: 2}]}),
    {setAsides: [{tag: 'transport', amount: 200000}], pockets: [pocket]});
eq(M.cleanPlan(null), {setAsides: [], pockets: []});
print('money: ok');
