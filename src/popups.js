// Short messages on the closed island (volume, battery, headphones): icon and text on the left,
// an optional level bar on the right. One slot: a newer pop-up replaces the one showing.
import Clutter from 'gi://Clutter';
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
        const right = new St.BoxLayout({style_class: 'revelio-wing-right', x_expand: true});
        right.add_child(this._level);
        right.add_child(this._percent);

        this._popup = {left, right};
    }

    // level: 0..1, or null to show only icon and text.
    show(iconName, text, level = null) {
        this._icon.icon_name = iconName;
        this._text.text = text;
        this._level.visible = this._percent.visible = level !== null;
        if (level !== null) {
            this._level.value = level;
            this._percent.text = `${Math.round(level * 100)}%`;
        }
        this._clear();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_MS, () => {
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
