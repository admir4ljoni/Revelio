// Shelf (17): drop files from apps onto the island to keep references (not copies) here, with
// open, show in folder and remove. Stored in ~/.local/share/revelio@midra/shelf.json.
// Mutter doesn't deliver client drops to the Shell, so we watch its DnD position and read the
// dragged URIs from the DnD selection while the pointer is over the island.
// ponytail: dragging files back out of the shell into apps isn't supported; add if missed.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as store from '../lib/store.js';

const URI_LIST = 'text/uri-list';

export class Shelf {
    constructor(island) {
        this._island = island;
        this._cancellable = new Gio.Cancellable();
        this._drag = null; // {over, uris, dropped} during a drag
        const saved = store.load('shelf', []);
        this._uris = Array.isArray(saved) ? saved.filter(u => typeof u === 'string') : [];

        this._row = new St.BoxLayout({style_class: 'revelio-shelf'});
        const scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
            child: this._row,
        });
        this._count = new St.Label({style_class: 'revelio-section-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const header = new St.BoxLayout();
        header.add_child(this._count);
        header.add_child(new St.Label({style_class: 'revelio-dim revelio-small', text: 'Drop files on the island to keep them here',
            y_align: Clutter.ActorAlign.CENTER}));
        this.page = new St.BoxLayout({style_class: 'revelio-tasks-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.page.add_child(header);
        this.page.add_child(scroll);
        island.addPage(this.page, 'Shelf');
        this._render();

        global.backend.get_dnd().connectObject(
            'dnd-enter', () => (this._drag = {over: false, uris: null, dropped: false}),
            'dnd-position-change', (_d, x, y) => this._onDragMove(x, y),
            'dnd-leave', () => this._onDragEnd(),
            this);
    }

    _onDragMove(x, y) {
        const drag = this._drag;
        if (!drag)
            return;
        const actor = this._island.actor;
        const [ok, ax, ay] = actor.transform_stage_point(x, y);
        const over = actor.visible && ok && ax >= 0 && ay >= 0 && ax < actor.width && ay < actor.height;
        if (over === drag.over)
            return;
        drag.over = over;
        if (over)
            actor.add_style_pseudo_class('drop');
        else
            actor.remove_style_pseudo_class('drop');
        if (over && !drag.uris)
            this._read(drag);
    }

    // Read once per drag, while the source still offers the data.
    _read(drag) {
        drag.uris = [];
        const selection = global.display.get_selection();
        if (!selection.get_mimetypes(Meta.SelectionType.SELECTION_DND).includes(URI_LIST))
            return;
        const out = Gio.MemoryOutputStream.new_resizable();
        selection.transfer_async(Meta.SelectionType.SELECTION_DND, URI_LIST, -1, out, this._cancellable, (_s, res) => {
            try {
                selection.transfer_finish(res);
                out.close(null);
                drag.uris = new TextDecoder().decode(out.steal_as_bytes().toArray())
                    .split(/\r?\n/).filter(u => u && !u.startsWith('#'));
                if (drag.dropped)
                    this._add(drag.uris);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    log(`Revelio: reading dropped files: ${e.message}`);
            }
        });
    }

    _onDragEnd() {
        const drag = this._drag;
        this._drag = null;
        this._island.actor.remove_style_pseudo_class('drop');
        if (!drag?.over)
            return;
        drag.dropped = true;
        this._add(drag.uris ?? []); // empty while the transfer is still running; it adds them then
    }

    _add(uris) {
        const fresh = uris.filter(u => !this._uris.includes(u));
        if (!fresh.length)
            return;
        this._change([...this._uris, ...fresh]);
        this._island.open(this.page);
    }

    _change(uris) {
        this._uris = uris;
        try {
            store.save('shelf', uris);
        } catch (e) {
            logError(e, 'Revelio: saving shelf');
        }
        this._render();
    }

    _render() {
        this._row.destroy_all_children();
        const n = this._uris.length;
        this._count.text = n === 1 ? '1 file' : `${n} files`;
        if (!n) {
            const empty = new St.BoxLayout({style_class: 'revelio-dropzone', orientation: Clutter.Orientation.VERTICAL,
                x_expand: true, y_expand: true});
            empty.add_child(new St.Icon({icon_name: 'folder-download-symbolic', style_class: 'revelio-dropzone-icon',
                x_align: Clutter.ActorAlign.CENTER, y_expand: true, y_align: Clutter.ActorAlign.END}));
            empty.add_child(new St.Label({style_class: 'revelio-dim', text: 'Drag files here', x_align: Clutter.ActorAlign.CENTER,
                y_expand: true, y_align: Clutter.ActorAlign.START}));
            this._row.add_child(empty);
            return;
        }
        for (const uri of this._uris) {
            const file = Gio.File.new_for_uri(uri);
            const name = file.get_basename() ?? uri;
            // ponytail: icon guessed from the name (no disk I/O), so folders get a generic icon.
            const [type] = Gio.content_type_guess(name, null);
            const open = new St.Button({style_class: 'revelio-shelf-open', can_focus: true,
                child: new St.Icon({gicon: Gio.content_type_get_icon(type), style_class: 'revelio-shelf-icon'})});
            open.connect('clicked', () => {
                try {
                    Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
                } catch (e) {
                    log(`Revelio: opening ${uri}: ${e.message}`);
                }
            });
            const button = (icon, action) => {
                const b = new St.Button({style_class: 'revelio-row-action', can_focus: true, child: new St.Icon({icon_name: icon})});
                b.connect('clicked', action);
                return b;
            };
            const actions = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'revelio-shelf-actions'});
            actions.add_child(button('folder-open-symbolic', () => Gio.DBus.session.call('org.freedesktop.FileManager1',
                '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1', 'ShowItems',
                new GLib.Variant('(ass)', [[uri], '']), null, Gio.DBusCallFlags.NONE, -1, null, null)));
            actions.add_child(button('window-close-symbolic', () => this._change(this._uris.filter(u => u !== uri))));
            const label = new St.Label({style_class: 'revelio-shelf-name', text: name, x_align: Clutter.ActorAlign.CENTER});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const item = new St.BoxLayout({style_class: 'revelio-shelf-item revelio-list-row', orientation: Clutter.Orientation.VERTICAL,
                reactive: true, track_hover: true});
            item.add_child(open);
            item.add_child(label);
            item.add_child(actions);
            this._row.add_child(item);
        }
    }

    destroy() {
        this._cancellable.cancel();
        global.backend.get_dnd().disconnectObject(this);
        this._island.actor.remove_style_pseudo_class('drop');
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
