// Today (16): the date on the left, this week plus the next four as a grid in the middle (days with
// events marked; ‹ › page through whole months), upcoming events on the right. Events come from the Shell's own Evolution Data Server client.
// Built only while the page is visible.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

const WEEKS = 5;
const MAX_EVENTS = 4;

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

export class Today {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._events = null; // created on first show

        this._weekday = new St.Label({style_class: 'revelio-today-weekday'});
        this._day = new St.Label({style_class: 'revelio-today-day'});
        this._month = new St.Label({style_class: 'revelio-today-month'});
        this._week = new St.Label({style_class: 'revelio-dim'});
        const left = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-today-date',
            y_align: Clutter.ActorAlign.CENTER});
        [this._weekday, this._day, this._month, this._week].forEach(l => left.add_child(l));
        this._layout = new Clutter.GridLayout();
        this._grid = new St.Widget({style_class: 'revelio-cal', layout_manager: this._layout});
        this._offset = 0; // months from now; 0 = this week and the next four
        const nav = (icon, step) => {
            const b = new St.Button({style_class: 'revelio-row-action revelio-cal-nav', can_focus: true, child: new St.Icon({icon_name: icon})});
            b.connect('clicked', () => this._go(this._offset + step));
            return b;
        };
        // The label jumps back to today.
        this._monthButton = new St.Button({style_class: 'revelio-cal-title', can_focus: true, x_expand: true});
        this._monthButton.connect('clicked', () => this._go(0));
        const navRow = new St.BoxLayout();
        navRow.add_child(nav('go-previous-symbolic', -1));
        navRow.add_child(this._monthButton);
        navRow.add_child(nav('go-next-symbolic', 1));
        const calendar = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
        calendar.add_child(navRow);
        calendar.add_child(this._grid);
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-today-events'});
        const right = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'revelio-today-right'});
        right.add_child(new St.Label({style_class: 'revelio-caption', text: 'UPCOMING'}));
        right.add_child(this._list);
        this.page = new St.BoxLayout({style_class: 'revelio-today-page', x_expand: true});
        this.page.add_child(left);
        this.page.add_child(calendar);
        this.page.add_child(right);
        this.page.connectObject('notify::mapped', () => {
            if (!this.page.mapped)
                this._offset = 0; // reopen on today
            this._render();
        }, this);
        island.addPage(this.page, 'Today', 'x-office-calendar-symbolic');
    }

    _render() {
        if (!this.page.mapped)
            return;
        if (!this._events) {
            this._events = new Calendar.DBusEventSource();
            this._events.connectObject('changed', () => this._render(), this);
        }
        const now = new Date();
        const today = addDays(now, 0);
        const weekStart = d => addDays(d, -((d.getDay() - Shell.util_get_week_start() + 7) % 7));
        const end = addDays(weekStart(today), 7 * WEEKS); // upcoming events: the next five weeks
        // Grid: the next five weeks, or the whole month `offset` months away.
        const month = new Date(today.getFullYear(), today.getMonth() + this._offset, 1);
        const begin = weekStart(this._offset ? month : today);
        const weeks = this._offset
            ? Math.ceil(((month.getTime() - begin.getTime()) / 86400000 + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7)
            : WEEKS;
        const gridEnd = addDays(begin, 7 * weeks);
        // One range covers both; no-op when unchanged, and 'changed' re-renders.
        this._events.requestRange(begin < today ? begin : weekStart(today), gridEnd > end ? gridEnd : end);
        this._monthButton.label = GLib.DateTime.new_local(month.getFullYear(), month.getMonth() + 1, 1, 0, 0, 0).format('%B %Y');
        if (this._offset)
            this._monthButton.add_style_pseudo_class('away');
        else
            this._monthButton.remove_style_pseudo_class('away');

        const dt = GLib.DateTime.new_now_local();
        this._weekday.text = dt.format('%A').toUpperCase();
        this._day.text = dt.format('%-d');
        this._month.text = dt.format('%B %Y');
        this._week.text = `Week ${dt.get_week_of_year()}`;

        this._list.destroy_all_children();
        const time = this._settings.get_boolean('clock-24h') ? '%H:%M' : '%-l:%M %p';
        const events = this._events.getEvents(now, end).slice(0, MAX_EVENTS);
        for (const e of events) {
            const start = GLib.DateTime.new_from_unix_local(Math.max(e.date.getTime(), now.getTime()) / 1000 | 0);
            const allDay = e.date.getHours() === 0 && e.date.getMinutes() === 0 && e.end.getTime() - e.date.getTime() >= 86400000;
            const day = e.date < addDays(today, 1) ? 'Today' : start.format('%a %-d');
            const card = new St.BoxLayout({style_class: 'revelio-event'});
            card.add_child(new St.Widget({style_class: 'revelio-event-bar'}));
            const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
            const title = new St.Label({style_class: 'revelio-event-title', text: e.summary});
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(title);
            text.add_child(new St.Label({style_class: 'revelio-dim revelio-small', text: allDay ? `${day} · all day` : `${day} · ${start.format(time)}`}));
            card.add_child(text);
            this._list.add_child(card);
        }
        if (!events.length)
            this._list.add_child(new St.Label({style_class: 'revelio-dim', text: 'Nothing on the calendar'}));

        this._grid.destroy_all_children();
        const weekday = new Intl.DateTimeFormat(undefined, {weekday: 'narrow'});
        for (let col = 0; col < 7; col++) {
            const head = new St.Label({style_class: 'revelio-cal-head', text: weekday.format(addDays(begin, col)),
                x_align: Clutter.ActorAlign.CENTER});
            this._layout.attach(head, col, 0, 1, 1);
        }
        for (let i = 0; i < 7 * weeks; i++) {
            const date = addDays(begin, i);
            const label = new St.Label({style_class: 'revelio-cal-day', text: String(date.getDate()), x_align: Clutter.ActorAlign.CENTER});
            if (date.getTime() === today.getTime())
                label.add_style_pseudo_class('today');
            else if (date < today && !this._offset) // a browsed month stays readable
                label.add_style_pseudo_class('past');
            else if (date.getMonth() !== month.getMonth())
                label.add_style_pseudo_class('other-month');
            if (this._events.hasEvents(date))
                label.add_style_class_name('revelio-cal-event');
            this._layout.attach(label, i % 7, 1 + Math.floor(i / 7), 1, 1);
        }
    }

    _go(offset) {
        this._offset = offset;
        this._render();
    }

    destroy() {
        this._events?.disconnectObject(this);
        // ponytail: the Shell's DBusEventSource logs "already disposed" criticals if destroyed before
        // its D-Bus init finishes (disable within ~1 s of first showing the page). Harmless; defer if it nags.
        this._events?.destroy();
        this._events = null;
        this.page.disconnectObject(this);
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
