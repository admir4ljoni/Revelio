// Screen recorder (39): a tab with one button that opens GNOME's own screenshot UI in screencast mode.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
// @ts-expect-error: @girs/gnome-shell has no types for screenshot.js
import * as Screenshot from 'resource:///org/gnome/shell/ui/screenshot.js';

export class Recorder {
    constructor(island) {
        this._island = island;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-recorder'});
        box.add_child(new St.Icon({icon_name: 'media-record-symbolic', style_class: 'revelio-recorder-icon'}));
        box.add_child(new St.Label({text: 'Record screen', x_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({style_class: 'revelio-shelf-open', child: box, can_focus: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        button.connect('clicked', () => Screenshot.showScreenRecordingUI());
        this.page = new St.Bin({child: button, x_expand: true, y_expand: true});
        island.addPage(this.page);
    }

    destroy() {
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
