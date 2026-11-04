// Clipboard (35): the last copied texts, in memory only (gone on log-out or lock). Click one to
// copy it again. Password managers that mark their copies (x-kde-passwordManagerHint) are skipped.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {ago} from '../lib/ago.js';

const MAX_ITEMS = 20;
const MAX_CHARS = 100000; // ponytail: bigger copies aren't kept; raise if real use needs it
const SECRET = 'x-kde-passwordManagerHint';


export class Clipboard {
    constructor(island) {
        this._island = island;
        this._items = []; // {text, at (monotonic µs)}
        this._clipboard = St.Clipboard.get_default();

        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._list,
        });
        this._count = new St.Label({style_class: 'revelio-section-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._clear = new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true, label: 'Clear'});
        this._clear.connect('clicked', () => {
            this._items = [];
            this._render();
        });
        const header = new St.BoxLayout();
        header.add_child(this._count);
        header.add_child(this._clear);
        this.page = new St.BoxLayout({style_class: 'revelio-tasks-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.page.add_child(header);
        this.page.add_child(scroll);
        // Times are relative; refresh them when the page shows instead of on a timer.
        this.page.connectObject('notify::mapped', () => this.page.mapped && this._render(), this);
        island.addPage(this.page, 'Clipboard');
        this._render();

        global.display.get_selection().connectObject('owner-changed', (_s, type, source) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD && source && !source.get_mimetypes().includes(SECRET))
                this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => this._add(text));
        }, this);
    }

    _add(text) {
        if (!this._items || !text?.trim() || text.length > MAX_CHARS)
            return; // destroyed while reading, empty, or too big
        this._items = [{text, at: GLib.get_monotonic_time()}, ...this._items.filter(i => i.text !== text)].slice(0, MAX_ITEMS);
        this._render();
    }

    _render() {
        this._list.destroy_all_children();
        const n = this._items.length;
        this._count.text = n === 1 ? '1 item' : `${n} items`;
        this._clear.visible = n > 0;
        if (!n) {
            this._list.add_child(new St.Label({style_class: 'revelio-dim revelio-empty', text: 'Copied text shows up here',
                x_align: Clutter.ActorAlign.CENTER}));
        }
        for (const {text, at} of this._items) {
            const label = new St.Label({style_class: 'revelio-clip-text', text: text.trim().replace(/\s+/g, ' ').slice(0, 200),
                x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const row = new St.BoxLayout({style_class: 'revelio-row', x_expand: true});
            row.add_child(label);
            row.add_child(new St.Label({style_class: 'revelio-dim revelio-small', text: ago(GLib.get_monotonic_time() - at), y_align: Clutter.ActorAlign.CENTER}));
            const b = new St.Button({style_class: 'revelio-list-row revelio-clip-item', child: row, can_focus: true,
                x_expand: true, x_align: Clutter.ActorAlign.FILL});
            b.connect('clicked', () => this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text));
            this._list.add_child(b);
        }
        if (n)
            this._list.add_child(new St.Label({style_class: 'revelio-dim revelio-small revelio-hint', text: 'Click a row to copy it again',
                x_align: Clutter.ActorAlign.CENTER}));
    }

    destroy() {
        global.display.get_selection().disconnectObject(this);
        this.page.disconnectObject(this);
        this._items = null;
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
