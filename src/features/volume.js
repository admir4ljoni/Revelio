// Volume (9): pop-up when the default output's volume or mute changes.
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

export class VolumePopup {
    constructor(popups) {
        this._popups = popups;
        this._control = Volume.getMixerControl(); // shared with the Shell; don't close it
        this._control.connectObject('default-sink-changed', () => this._bind(), this);
        this._bind();
    }

    // Switching outputs isn't a volume change, so no pop-up here.
    _bind() {
        this._stream?.disconnectObject(this);
        this._stream = this._control.get_default_sink();
        this._stream?.connectObject('notify::volume', () => this._show(), 'notify::is-muted', () => this._show(), this);
    }

    _show() {
        const level = this._stream.is_muted ? 0 : this._stream.volume / this._control.get_vol_max_norm();
        const icon = level <= 0 ? 'muted' : ['low', 'medium', 'high'][Math.min(2, Math.ceil(level * 3) - 1)];
        this._popups.show(`audio-volume-${icon}-symbolic`, this._stream.is_muted ? 'Muted' : 'Volume', Math.min(1, level));
    }

    destroy() {
        this._stream?.disconnectObject(this);
        this._control.disconnectObject(this);
        this._stream = null;
    }
}
