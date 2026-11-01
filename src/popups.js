// Short messages on the closed island (volume, battery, headphones, notifications): icon and text
// on the left, an optional level bar or detail text on the right. One slot: a newer pop-up replaces the one showing.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';

const SHOW_MS = 1500;

export class Popups {
    constructor(island) {
        this._island = island;
        this._timeoutId = 0;

        this._icon = new St.Icon({style_class: 'revelio-popup-icon', y_align: Clutter.ActorAlign.CENTER});
        this._text = new St.Label({style_class: 'revelio-popup-text', y_align: Clutter.ActorAlign.CENTER});
        const left = new St.BoxLayout({style_class: 'revelio-wing-left', x_expand: true});
        left.add_child(this._icon);
        left.add_child(this._text);

        this._level = new BarLevel.BarLevel({style_class: 'revelio-level', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._percent = new St.Label({style_class: 'revelio-popup-percent', y_align: Clutter.ActorAlign.CENTER});
        this._detail = new St.Label({style_class: 'revelio-popup-detail', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const right = new St.BoxLayout({style_class: 'revelio-wing-right', x_expand: true});
        right.add_child(this._level);
        right.add_child(this._percent);
        right.add_child(this._detail);

        this._popup = {left, right};
    }

    // icon: a name or a Gio.Icon. level: 0..1, or null to show `detail` (if any) instead.
    show(icon, text, level = null, {detail = '', ms = SHOW_MS} = {}) {
        this._icon.gicon = typeof icon === 'string' ? new Gio.ThemedIcon({name: icon}) : icon;
        this._text.text = text;
        this._level.visible = this._percent.visible = level !== null;
        this._detail.visible = level === null && !!detail;
        this._detail.text = detail;
        if (level !== null) {
            this._level.value = level;
            this._percent.text = `${Math.round(level * 100)}%`;
        }
        this._clear();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeoutId = 0;
            this._island.setPopup(null);
            return GLib.SOURCE_REMOVE;
        });
        this._island.setPopup(this._popup);
    }

    _clear() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
    }

    destroy() {
        this._clear();
        this._island.setPopup(null);
        this._popup.left.destroy();
        this._popup.right.destroy();
    }
}
