// Clipboard (35): the last copied texts, in memory only (gone on log-out or lock). Click one to
// copy it again. Password managers that mark their copies (x-kde-passwordManagerHint) are skipped.
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

const MAX_ITEMS = 20;
const MAX_CHARS = 100000; // ponytail: bigger copies aren't kept; raise if real use needs it
const SECRET = 'x-kde-passwordManagerHint';

export class Clipboard {
    constructor(island) {
        this._island = island;
        this._items = [];
        this._clipboard = St.Clipboard.get_default();

        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._list,
        });
        const clear = new St.Button({style_class: 'revelio-media-button', can_focus: true, y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'edit-clear-all-symbolic'})});
        clear.connect('clicked', () => {
            this._items = [];
            this._render();
        });
        this.page = new St.BoxLayout({style_class: 'revelio-tasks-page', x_expand: true});
        this.page.add_child(scroll);
        this.page.add_child(clear);
        island.addPage(this.page, 'Clipboard', 'edit-paste-symbolic');
        this._render();

        global.display.get_selection().connectObject('owner-changed', (_s, type, source) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD && source && !source.get_mimetypes().includes(SECRET))
                this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => this._add(text));
        }, this);
    }

    _add(text) {
        if (!this._items || !text?.trim() || text.length > MAX_CHARS)
            return; // destroyed while reading, empty, or too big
        this._items = [text, ...this._items.filter(t => t !== text)].slice(0, MAX_ITEMS);
        this._render();
    }

    _render() {
        this._list.destroy_all_children();
        if (!this._items.length)
            this._list.add_child(new St.Label({style_class: 'revelio-dim', text: 'Copied text shows up here'}));
        for (const text of this._items) {
            const label = new St.Label({style_class: 'revelio-clip-text', text: text.trim().replace(/\s+/g, ' ').slice(0, 200)});
            const b = new St.Button({style_class: 'revelio-clip-item', child: label, can_focus: true,
                x_expand: true, x_align: Clutter.ActorAlign.FILL});
            b.connect('clicked', () => this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text));
            this._list.add_child(b);
        }
    }

    destroy() {
        global.display.get_selection().disconnectObject(this);
        this._items = null;
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
