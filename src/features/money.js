// Money: a monthly budget on one page. Add money (cash or e-wallet), log spending ("25k lunch #food"),
// move money between wallets, and recount what you actually hold (the gap is logged as Untracked).
// The ring shows how much of the month's money is spent, with a tick for how much of the month has
// gone. Stored in ~/.local/share/revelio@midra/money.json. Logic lives in lib/money.js.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as store from '../lib/store.js';
import * as M from '../lib/money.js';
import {paintRing} from './focus.js';

const RING = {ok: [0.47, 0.68, 0.93], ahead: [1, 0.62, 0.26], over: [0.88, 0.27, 0.27]};
const FORMS = {
    in: {title: 'Add money', hint: 'Amount and note, e.g. 5jt salary', save: 'Add'},
    out: {title: 'Spend', hint: 'Amount and note, e.g. 25k lunch #food', save: 'Save'},
    move: {title: 'Move money', hint: 'Amount, e.g. 200k', save: 'Move'},
    recount: {title: 'Recount', hint: 'How much do you have right now?', save: 'Recount'},
};

const pill = (icon, text) => {
    const box = new St.BoxLayout({style_class: 'revelio-pill-box'});
    box.add_child(new St.Icon({icon_name: icon}));
    box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
    return new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true, child: box});
};

// A segmented control of [value, label]; `onPick(value)` on click. Returns {actor, set(value)}.
const segmented = (choices, onPick) => {
    const actor = new St.BoxLayout({style_class: 'revelio-segmented', y_align: Clutter.ActorAlign.CENTER});
    const buttons = choices.map(([value, text]) => {
        const b = new St.Button({style_class: 'revelio-segment revelio-chip', can_focus: true, label: text});
        b.connect('clicked', () => onPick(value));
        actor.add_child(b);
        return [value, b];
    });
    const set = value => buttons.forEach(([v, b]) => (v === value ? b.add_style_pseudo_class('checked') : b.remove_style_pseudo_class('checked')));
    return {actor, set};
};

export class Money {
    constructor(island) {
        this._island = island;
        this._entries = M.clean(store.load('money', []));
        this._form = null; // 'in' | 'out' | 'move' | 'recount' while a form is open
        this._wallet = this._entries.at(-1)?.wallet ?? 'cash';

        const actions = new St.BoxLayout({style_class: 'revelio-row'});
        for (const [icon, text, form] of [['list-add-symbolic', 'Money', 'in'], ['list-remove-symbolic', 'Spend', 'out'],
            ['object-flip-horizontal-symbolic', 'Move', 'move'], ['view-refresh-symbolic', 'Recount', 'recount']]) {
            const b = pill(icon, text);
            b.connect('clicked', () => this._openForm(form));
            actions.add_child(b);
        }
        this._actions = actions;

        this.page = new St.BoxLayout({style_class: 'revelio-money-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.page.add_child(actions);
        this._overview = this._buildOverview();
        this._formBox = this._buildForm();
        this.page.add_child(this._overview);
        this.page.add_child(this._formBox);
        // Recompute when shown: the day (and so the allowance and pace) may have changed. No timers.
        this.page.connect('notify::mapped', () => this.page.mapped && this._render());
        island.addPage(this.page, 'Money', 'accessories-calculator-symbolic');
        this._render();
    }

    _buildOverview() {
        // Left: the ring. Middle: today's allowance, the month, wallets, a tip. Right: recent entries.
        this._ring = new St.DrawingArea({style_class: 'revelio-money-ring'});
        this._ring.connect('repaint', area => paintRing(area, this._used ?? 0, RING[this._state], this._pace));
        this._ringValue = new St.Label({style_class: 'revelio-money-ring-value', x_align: Clutter.ActorAlign.CENTER});
        this._ringCaption = new St.Label({style_class: 'revelio-focus-phase', x_align: Clutter.ActorAlign.CENTER});
        const inner = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        inner.add_child(this._ringValue);
        inner.add_child(this._ringCaption);
        const dial = new St.Widget({layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        dial.add_child(this._ring);
        dial.add_child(inner);

        this._todayLeft = new St.Label({style_class: 'revelio-money-big'});
        this._monthLine = new St.Label({style_class: 'revelio-money-line'});
        this._wallets = new St.Label({style_class: 'revelio-money-line revelio-dim'});
        this._tip = new St.Label({style_class: 'revelio-money-tip'});
        this._tip.clutter_text.line_wrap = true;
        const middle = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style_class: 'revelio-money-middle'});
        middle.add_child(new St.Label({style_class: 'revelio-caption', text: 'LEFT FOR TODAY'}));
        for (const a of [this._todayLeft, this._monthLine, this._wallets, this._tip])
            middle.add_child(a);

        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({y_expand: true, hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, child: this._list});
        const recent = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-money-recent'});
        recent.add_child(new St.Label({style_class: 'revelio-caption', text: 'RECENT'}));
        recent.add_child(scroll);

        const box = new St.BoxLayout({style_class: 'revelio-money-overview', x_expand: true, y_expand: true});
        box.add_child(dial);
        box.add_child(middle);
        box.add_child(recent);
        return box;
    }

    _buildForm() {
        this._formTitle = new St.Label({style_class: 'revelio-section-title', y_align: Clutter.ActorAlign.CENTER});
        this._entry = new St.Entry({style_class: 'revelio-entry', can_focus: true, x_expand: true});
        const text = this._entry.clutter_text;
        text.connectObject('key-focus-in', () => this._island.grabKeys(text), 'activate', () => this._save(), this);
        const top = new St.BoxLayout({style_class: 'revelio-row'});
        top.add_child(this._formTitle);
        top.add_child(this._entry);

        this._categories = new St.BoxLayout({style_class: 'revelio-segmented', x_align: Clutter.ActorAlign.START});

        const pickWallet = w => {
            this._wallet = w;
            this._syncForm();
        };
        this._walletSeg = segmented(Object.entries(M.WALLETS), pickWallet);
        this._moveSeg = segmented([['cash', 'Cash → E-wallet'], ['ewallet', 'E-wallet → Cash']], pickWallet);
        this._dateSeg = segmented([[0, 'Today'], [-1, 'Yesterday']], d => {
            this._dayOffset = d;
            this._month = null; // back to the default for the new date
            this._syncForm();
        });
        this._monthSeg = new St.BoxLayout(); // "counts for" this/next month, rebuilt with the date
        const cancel = new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true, label: 'Cancel'});
        cancel.connect('clicked', () => this._closeForm());
        this._saveButton = new St.Button({style_class: 'revelio-pill revelio-pill-small revelio-pill-accent', can_focus: true});
        this._saveButton.connect('clicked', () => this._save());
        const options = new St.BoxLayout({style_class: 'revelio-row'});
        for (const a of [this._walletSeg.actor, this._moveSeg.actor, this._dateSeg.actor, this._monthSeg,
            new St.Widget({x_expand: true}), cancel, this._saveButton])
            options.add_child(a);

        this._formHint = new St.Label({style_class: 'revelio-dim revelio-small'});
        const box = new St.BoxLayout({style_class: 'revelio-money-form', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true, visible: false});
        for (const a of [top, this._categories, options, this._formHint])
            box.add_child(a);
        return box;
    }

    _openForm(form) {
        this._form = form;
        this._category = null;
        this._dayOffset = 0;
        this._month = null; // default from the date
        this._entry.text = '';
        this._entry.hint_text = FORMS[form].hint;
        this._formTitle.text = FORMS[form].title;
        this._saveButton.label = FORMS[form].save;
        this._formHint.text = '';
        this._overview.hide();
        this._actions.hide();
        this._formBox.show();
        this._syncForm();
        this._island.grabKeys(this._entry.clutter_text);
    }

    _closeForm() {
        this._form = null;
        this._formBox.hide();
        this._overview.show();
        this._actions.show();
        this._render();
    }

    _date() {
        return M.addDays(M.iso(new Date()), this._dayOffset);
    }

    _syncForm() {
        const f = this._form, date = this._date();
        this._walletSeg.actor.visible = f !== 'move';
        this._moveSeg.actor.visible = f === 'move';
        this._dateSeg.actor.visible = f !== 'recount';
        this._walletSeg.set(this._wallet);
        this._moveSeg.set(this._wallet);
        this._dateSeg.set(this._dayOffset);

        this._monthSeg.destroy_all_children();
        if (f === 'in') {
            const month = this._month ?? M.defaultMonth(date), base = date.slice(0, 7);
            const seg = segmented([base, M.addMonths(base, 1)].map(m => [m, `For ${M.monthName(m).slice(0, 3)}`]),
                m => {
                    this._month = m;
                    this._syncForm();
                });
            seg.set(month);
            this._monthSeg.add_child(seg.actor);
        }

        this._categories.destroy_all_children();
        this._categories.visible = f === 'out';
        if (f === 'out') {
            const used = this._entries.filter(e => e.kind === 'out' && e.category).map(e => e.category);
            const tags = [...new Set([...M.PRESETS, ...used])].filter(t => t !== 'untracked').slice(0, 10);
            for (const tag of tags) {
                const chip = new St.Button({style_class: 'revelio-segment revelio-chip', can_focus: true, label: M.label(tag)});
                if (tag === this._category)
                    chip.add_style_pseudo_class('checked');
                chip.connect('clicked', () => {
                    this._category = tag === this._category ? null : tag;
                    this._syncForm();
                });
                this._categories.add_child(chip);
            }
        }
        if (f === 'recount')
            this._formHint.text = `Logged so far: ${M.idr(M.balances(this._entries)[this._wallet])} in ${M.WALLETS[this._wallet]}. The difference is saved as Untracked.`;
    }

    _save() {
        const input = this._entry.text, f = this._form, date = this._date();
        const {amount, note, tag} = M.parseEntry(input);
        const zero = f === 'recount' && input.trim() === '0';
        if (!amount && !zero) {
            this._formHint.text = 'Type an amount, like 25k, 25.000 or 1,5jt.';
            return;
        }
        /** @type {object} */
        let entry = {amount, wallet: this._wallet, date, ...note ? {note} : {}};
        if (f === 'out') {
            entry = {kind: 'out', ...entry, category: tag ?? this._category ?? 'other'};
        } else if (f === 'in') {
            const month = this._month ?? M.defaultMonth(date);
            entry = {kind: 'in', ...entry, ...month !== date.slice(0, 7) ? {month} : {}};
        } else if (f === 'move') {
            entry = {kind: 'move', ...entry, to: this._wallet === 'cash' ? 'ewallet' : 'cash'};
        } else {
            const diff = (zero ? 0 : amount) - M.balances(this._entries)[this._wallet];
            if (!diff) {
                this._closeForm();
                return;
            }
            entry = diff < 0 ? {kind: 'out', amount: -diff, wallet: this._wallet, date, note: 'Recount', category: 'untracked'}
                : {kind: 'in', amount: diff, wallet: this._wallet, date, note: 'Recount'};
        }
        this._change([...this._entries, entry]);
        this._closeForm();
    }

    _change(entries) {
        this._entries = entries;
        try {
            store.save('money', entries);
        } catch (e) {
            logError(e, 'Revelio: saving money');
        }
        this._render();
    }

    _render() {
        if (this._form)
            return;
        const date = M.iso(new Date());
        const t = M.today(this._entries, date);
        this._pace = t.pace;
        this._used = t.used ?? (t.spent ? 1 : 0);
        const over = t.left < 0 || (t.spent > 0 && (t.used ?? 1) >= 1);
        this._state = over ? 'over' : (t.paceUsed ?? 0) > t.pace + 0.1 ? 'ahead' : 'ok';
        this._ringValue.text = t.used === null ? '—' : M.pct(t.used);
        this._ringCaption.text = t.used === null ? 'no budget' : 'spent';
        this._ring.queue_repaint();

        this._todayLeft.text = M.idr(t.todayLeft);
        if (t.todayLeft < 0)
            this._todayLeft.add_style_pseudo_class('negative');
        else
            this._todayLeft.remove_style_pseudo_class('negative');
        this._monthLine.text = `${M.idr(t.left)} of ${M.idr(t.budget)} left in ${M.monthName(t.month).split(' ')[0]}`;
        const b = M.balances(this._entries);
        this._wallets.text = `Cash ${M.idr(b.cash)}  ·  E-wallet ${M.idr(b.ewallet)}`;
        this._tip.text = M.tips(this._entries, date).join('\n');

        this._list.destroy_all_children();
        const recent = this._entries.map((e, i) => [e, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).slice(0, 30);
        if (!recent.length)
            this._list.add_child(new St.Label({style_class: 'revelio-dim revelio-small', text: 'Nothing logged yet'}));
        for (const [e] of recent)
            this._list.add_child(this._row(e, date));
    }

    _row(e, date) {
        const what = e.kind === 'move' ? `${M.WALLETS[e.wallet]} → ${M.WALLETS[e.to]}`
            : e.note || (e.kind === 'in' ? 'Money added' : M.label(e.category || 'other'));
        const when = e.date === date ? 'Today' : e.date === M.addDays(date, -1) ? 'Yesterday' : e.date.slice(5).split('-').reverse().join('/');
        const sub = e.kind === 'out' ? `${when} · ${M.label(e.category || 'other')}` : e.kind === 'in' && e.month
            ? `${when} · for ${M.monthName(e.month, true)}` : `${when} · ${M.WALLETS[e.wallet]}`;
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        text.add_child(new St.Label({style_class: 'revelio-money-what', text: what}));
        text.add_child(new St.Label({style_class: 'revelio-dim revelio-small', text: sub}));
        const amount = new St.Label({style_class: `revelio-money-amount revelio-money-${e.kind}`, y_align: Clutter.ActorAlign.CENTER,
            text: `${e.kind === 'out' ? '−' : e.kind === 'in' ? '+' : ''}${M.idr(e.amount).slice(3)}`});
        const remove = new St.Button({style_class: 'revelio-row-action', can_focus: true, y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'window-close-symbolic'})});
        remove.connect('clicked', () => this._change(this._entries.filter(x => x !== e)));
        const row = new St.BoxLayout({style_class: 'revelio-list-row revelio-money-row', reactive: true, track_hover: true});
        row.add_child(text);
        row.add_child(amount);
        row.add_child(remove);
        return row;
    }

    destroy() {
        this._entry.clutter_text.disconnectObject(this);
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
