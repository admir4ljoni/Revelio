// Volume (9): pop-up when the default output's volume or mute changes.
// `icon` follows the volume for the status-bar idle look.
import St from 'gi://St';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

export class VolumePopup {
    constructor(popups) {
        this._popups = popups;
        this.icon = new St.Icon({style_class: 'revelio-status-icon'});
        this._control = Volume.getMixerControl(); // shared with the Shell; don't close it
        this._control.connectObject('default-sink-changed', () => this._bind(), this);
        this._bind();
    }

    // Switching outputs isn't a volume change, so no pop-up here.
    _bind() {
        this._stream?.disconnectObject(this);
        this._stream = this._control.get_default_sink();
        this._stream?.connectObject('notify::volume', () => this._show(), 'notify::is-muted', () => this._show(), this);
        this._level();
    }

    _level() {
        const level = !this._stream || this._stream.is_muted ? 0 : this._stream.volume / this._control.get_vol_max_norm();
        const icon = level <= 0 ? 'muted' : ['low', 'medium', 'high'][Math.min(2, Math.ceil(level * 3) - 1)];
        this.icon.icon_name = `audio-volume-${icon}-symbolic`;
        return level;
    }

    _show() {
        const level = this._level();
        this._popups.show(this.icon.icon_name, this._stream.is_muted ? 'Muted' : 'Volume', Math.min(1, level));
    }

    destroy() {
        this._stream?.disconnectObject(this);
        this._control.disconnectObject(this);
        this._stream = null;
        this.icon.destroy();
    }
}
