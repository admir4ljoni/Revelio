// Money: a monthly budget on one page. Add money (cash or e-wallet), log spending ("25k lunch #food";
// Untracked for money that went missing), and move money between wallets, each on any past day.
// Three rings: the month's money (Total), Cash and E-wallet, each showing the share spent with a tick
// for how much of the month has gone; the panel beside them details the last one hovered or clicked. Stored in ~/.local/share/revelio@midra/money.json. Logic lives in lib/money.js.
// Report writes ~/Documents/Revelio/Money.xlsx (a sheet per month, rebuilt each time) and opens it.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as store from '../lib/store.js';
import * as M from '../lib/money.js';
import {workbook} from '../lib/xlsx.js';
import {paintRing} from './focus.js';

const RING = {ok: [0.47, 0.68, 0.93], ahead: [1, 0.62, 0.26], over: [0.88, 0.27, 0.27]};
const FORMS = {
    in: {title: 'Add money', hint: 'Amount and note, e.g. 5jt salary', save: 'Add'},
    out: {title: 'Spend', hint: 'Amount and note, e.g. 25k lunch #food', save: 'Save'},
    move: {title: 'Move money', hint: 'Amount, e.g. 200k', save: 'Move'},
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
        this._form = null; // 'in' | 'out' | 'move' while a form is open
        this._wallet = this._entries.at(-1)?.wallet ?? 'cash';

        const actions = new St.BoxLayout({style_class: 'revelio-row'});
        for (const [icon, text, form] of [['list-add-symbolic', 'Money', 'in'], ['list-remove-symbolic', 'Spend', 'out'],
            ['object-flip-horizontal-symbolic', 'Move', 'move']]) {
            const b = pill(icon, text);
            b.connect('clicked', () => this._openForm(form));
            actions.add_child(b);
        }
        actions.add_child(new St.Widget({x_expand: true}));
        const history = pill('view-list-bullet-symbolic', 'History');
        history.connect('clicked', () => this._show('history'));
        actions.add_child(history);
        this._reportButton = pill('x-office-spreadsheet-symbolic', 'Report');
        this._reportButton.connect('clicked', () => this._report());
        actions.add_child(this._reportButton);
        this._actions = actions;

        this.page = new St.BoxLayout({style_class: 'revelio-money-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.page.add_child(actions);
        this._overview = this._buildOverview();
        this._formBox = this._buildForm();
        this._historyBox = this._buildHistory();
        for (const a of [this._overview, this._formBox, this._historyBox])
            this.page.add_child(a);
        // Recompute when shown: the day (and so the allowance and pace) may have changed. No timers.
        this.page.connect('notify::mapped', () => this.page.mapped && this._render());
        island.addPage(this.page, 'Money', 'accessories-calculator-symbolic');
        this._render();
    }

    _buildOverview() {
        // Left: three rings (Total, Cash, E-wallet). Right: details of the selected one, which is
        // the last ring hovered or clicked (it stays put when the pointer leaves).
        const rings = new St.BoxLayout({style_class: 'revelio-money-rings', y_align: Clutter.ActorAlign.CENTER});
        this._rings = {};
        for (const [key, name] of [['total', 'Total'], ['cash', 'Cash'], ['ewallet', 'E-wallet']]) {
            const r = {key, used: 0, pace: null, state: 'ok'};
            r.area = new St.DrawingArea({style_class: 'revelio-money-ring'});
            r.area.connect('repaint', area => paintRing(area, this._hidden ? 0 : r.used, RING[r.state], this._hidden ? null : r.pace));
            r.value = new St.Label({style_class: 'revelio-money-ring-value', x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER});
            const dial = new St.Widget({layout_manager: new Clutter.BinLayout()});
            dial.add_child(r.area);
            dial.add_child(r.value);
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-money-dial'});
            box.add_child(dial);
            box.add_child(new St.Label({style_class: 'revelio-money-ring-name', text: name, x_align: Clutter.ActorAlign.CENTER}));
            r.button = new St.Button({style_class: 'revelio-money-ring-button', can_focus: true, child: box});
            r.button.connect('clicked', () => this._select(key));
            r.button.connect('notify::hover', () => r.button.hover && this._select(key));
            this._rings[key] = r;
            rings.add_child(r.button);
        }
        this._selected = 'total';

        this._caption = new St.Label({style_class: 'revelio-caption'});
        this._big = new St.Label({style_class: 'revelio-money-big', y_align: Clutter.ActorAlign.CENTER});
        // The amount and the eye beside it are one button: either masks the rings and amounts
        // until clicked again (remembered across restarts).
        this._hidden = store.load('money-hidden', false) === true;
        this._eyeIcon = new St.Icon({style_class: 'revelio-money-eye', y_align: Clutter.ActorAlign.CENTER});
        const bigBox = new St.BoxLayout({style_class: 'revelio-money-big-box'});
        bigBox.add_child(this._big);
        bigBox.add_child(this._eyeIcon);
        this._eye = new St.Button({style_class: 'revelio-money-big-button', can_focus: true, x_align: Clutter.ActorAlign.START, child: bigBox});
        this._eye.connect('clicked', () => {
            this._hidden = !this._hidden;
            try {
                store.save('money-hidden', this._hidden);
            } catch (e) {
                logError(e, 'Revelio: saving money-hidden');
            }
            this._render();
        });
        this._line1 = new St.Label({style_class: 'revelio-money-line'});
        this._line2 = new St.Label({style_class: 'revelio-money-line revelio-dim'});
        this._tip = new St.Label({style_class: 'revelio-money-tip'});
        this._tip.clutter_text.line_wrap = true;
        const panel = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, style_class: 'revelio-money-middle'});
        for (const a of [this._caption, this._eye, this._line1, this._line2, this._tip])
            panel.add_child(a);

        const box = new St.BoxLayout({style_class: 'revelio-money-overview', x_expand: true, y_expand: true});
        box.add_child(rings);
        box.add_child(panel);
        return box;
    }

    _buildHistory() {
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({y_expand: true, hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, child: this._list});
        const back = new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true, label: 'Back'});
        back.connect('clicked', () => this._show('overview'));
        const head = new St.BoxLayout({style_class: 'revelio-row'});
        head.add_child(new St.Label({style_class: 'revelio-section-title', text: 'History', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        head.add_child(back);
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-money-history',
            x_expand: true, y_expand: true, visible: false});
        box.add_child(head);
        box.add_child(scroll);
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
        // Day stepper: ‹ Fri 30 Oct › plus Today. No future days.
        const step = (icon, change) => {
            const b = new St.Button({style_class: 'revelio-row-action revelio-cal-nav', can_focus: true, child: new St.Icon({icon_name: icon})});
            b.connect('clicked', () => this._setDay(change(this._dayOffset)));
            return b;
        };
        this._dayLabel = new St.Label({style_class: 'revelio-money-day', y_align: Clutter.ActorAlign.CENTER});
        this._dayNext = step('go-next-symbolic', d => Math.min(0, d + 1));
        this._dayToday = new St.Button({style_class: 'revelio-segment revelio-chip', can_focus: true, label: 'Today'});
        this._dayToday.connect('clicked', () => this._setDay(0));
        this._dateBox = new St.BoxLayout({style_class: 'revelio-segmented', y_align: Clutter.ActorAlign.CENTER});
        for (const a of [step('go-previous-symbolic', d => d - 1), this._dayLabel, this._dayNext, this._dayToday])
            this._dateBox.add_child(a);
        this._monthSeg = new St.BoxLayout(); // "counts for" this/next month, rebuilt with the date
        const cancel = new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true, label: 'Cancel'});
        cancel.connect('clicked', () => this._closeForm());
        this._saveButton = new St.Button({style_class: 'revelio-pill revelio-pill-small revelio-pill-accent', can_focus: true});
        this._saveButton.connect('clicked', () => this._save());
        const options = new St.BoxLayout({style_class: 'revelio-row'});
        for (const a of [this._walletSeg.actor, this._moveSeg.actor, this._dateBox, this._monthSeg,
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
        this._show('form');
        this._syncForm();
        this._island.grabKeys(this._entry.clutter_text);
    }

    _closeForm() {
        this._show('overview');
    }

    // One view at a time in the page: 'overview' (with the actions), 'form' or 'history'.
    _show(view) {
        if (view !== 'form')
            this._form = null;
        this._actions.visible = this._overview.visible = view === 'overview';
        this._formBox.visible = view === 'form';
        this._historyBox.visible = view === 'history';
        this._render();
    }

    _select(key) {
        if (this._selected === key)
            return;
        this._selected = key;
        this._render();
    }

    _setDay(offset) {
        this._dayOffset = offset;
        this._month = null; // back to the default "counts for" month of the new date
        this._syncForm();
    }

    _date() {
        return M.addDays(M.iso(new Date()), this._dayOffset);
    }

    _syncForm() {
        const f = this._form, date = this._date();
        this._walletSeg.actor.visible = f !== 'move';
        this._moveSeg.actor.visible = f === 'move';
        this._walletSeg.set(this._wallet);
        this._moveSeg.set(this._wallet);
        this._dayLabel.text = M.dayLabel(date, M.iso(new Date()));
        this._dayNext.reactive = this._dayOffset < 0;
        this._dayNext.opacity = this._dayOffset < 0 ? 255 : 70;
        this._dayToday.visible = this._dayOffset < 0;

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
            // Untracked last: money that's gone without knowing where.
            const tags = [...[...new Set([...M.PRESETS, ...used])].filter(t => t !== 'untracked').slice(0, 9), 'untracked'];
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
    }

    _save() {
        const input = this._entry.text, f = this._form, date = this._date();
        const {amount, note, tag} = M.parseEntry(input);
        if (!amount) {
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
        } else {
            entry = {kind: 'move', ...entry, to: this._wallet === 'cash' ? 'ewallet' : 'cash'};
        }
        this._change([...this._entries, entry]);
        this._closeForm();
    }

    _report() {
        const docs = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS) ?? GLib.get_home_dir();
        const dir = GLib.build_filenamev([docs, 'Revelio']), file = Gio.File.new_for_path(GLib.build_filenamev([dir, 'Money.xlsx']));
        try {
            GLib.mkdir_with_parents(dir, 0o755);
            file.replace_contents(workbook(M.reportSheets(this._entries, new Date())), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            logError(e, 'Revelio: writing the money report');
            this._tip.text = `Couldn’t save the report: ${e.message}`;
            return;
        }
        this._island.close();
        try {
            Gio.AppInfo.launch_default_for_uri(file.get_uri(), global.create_app_launch_context(0, -1));
        } catch (e) {
            Main.notify('Money report saved', file.get_path()); // no app for .xlsx
            logError(e, 'Revelio: opening the money report');
        }
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
        const date = M.iso(new Date()), t = M.today(this._entries, date);
        const hide = this._hidden, idr = n => (hide ? 'Rp •••' : M.idr(n)), pct = x => (hide ? '•••' : M.pct(x));
        this._eyeIcon.icon_name = hide ? 'view-conceal-symbolic' : 'view-reveal-symbolic';
        this._eye.accessible_name = hide ? 'Show amounts' : 'Hide amounts';
        const monthName = M.monthName(t.month).split(' ')[0];
        const total = this._rings.total;
        total.used = t.used ?? (t.spent ? 1 : 0);
        total.pace = t.pace;
        total.state = t.left < 0 || (t.spent > 0 && (t.used ?? 1) >= 1) ? 'over'
            : (t.paceUsed ?? 0) > t.pace + 0.1 ? 'ahead' : 'ok';
        total.value.text = t.used === null ? '—' : pct(t.used);
        const wallets = {};
        for (const key of Object.keys(M.WALLETS)) {
            const w = wallets[key] = M.walletMonth(this._entries, key, date), r = this._rings[key];
            r.used = w.used ?? (w.spent ? 1 : 0);
            r.pace = w.pace;
            r.state = w.left < 0 ? 'over' : 'ok';
            r.value.text = w.used === null ? '—' : pct(w.used);
        }
        for (const r of Object.values(this._rings)) {
            r.area.queue_repaint();
            if (r.key === this._selected)
                r.button.add_style_pseudo_class('checked');
            else
                r.button.remove_style_pseudo_class('checked');
        }

        if (this._selected === 'total') {
            this._caption.text = 'LEFT FOR TODAY';
            this._setBig(t.todayLeft, idr);
            this._line1.text = `${idr(t.left)} of ${idr(t.budget)} left in ${monthName}`;
            this._line2.text = `Spent ${idr(t.spent)} · ${t.used === null ? 'no money added yet' : `${pct(t.used)} of the month’s money`}`;
            this._tip.text = hide ? '' : M.tips(this._entries, date).join('\n');
        } else {
            const w = wallets[this._selected];
            this._caption.text = `${M.WALLETS[w.wallet].toUpperCase()} · LEFT`;
            this._setBig(w.left, idr);
            this._line1.text = `Spent ${idr(w.spent)} from ${M.WALLETS[w.wallet].toLowerCase()} in ${monthName}`;
            this._line2.text = w.left > 0 ? `About ${idr(w.perDay)} a day for the rest of ${monthName}` : '';
            this._tip.text = !hide && w.left < 0 ? 'Below zero: some money going in wasn’t logged, or a spend went to the wrong wallet.' : '';
        }

        this._reportButton.reactive = this._entries.length > 0;
        if (!this._historyBox.visible)
            return;
        this._list.destroy_all_children();
        const recent = this._entries.map((e, i) => [e, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).slice(0, 100);
        if (!recent.length)
            this._list.add_child(new St.Label({style_class: 'revelio-dim revelio-small', text: 'Nothing logged yet'}));
        for (const [e] of recent)
            this._list.add_child(this._row(e, date));
    }

    _setBig(amount, idr) {
        this._big.text = idr(amount);
        if (amount < 0 && !this._hidden)
            this._big.add_style_pseudo_class('negative');
        else
            this._big.remove_style_pseudo_class('negative');
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
