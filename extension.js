import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Island} from './src/island.js';
import {Music} from './src/features/music.js';

export default class RevelioExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._island = new Island(this._settings);
        this._music = new Music(this._island);

        // Lock is covered by having no `session-modes` (we get disabled). Screen off isn't:
        // watch Mutter's PowerSaveMode (0 = on) and pause the island.
        this._cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
            'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig', this._cancellable, (_o, res) => {
                try {
                    this._displayConfig = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, 'Revelio: no DisplayConfig, screen-off pause disabled');
                    return;
                }
                this._displayConfig.connectObject('g-properties-changed', () => this._syncPowerSave(), this);
                this._syncPowerSave();
            });
    }

    _syncPowerSave() {
        const mode = Number(this._displayConfig.get_cached_property('PowerSaveMode')?.unpack() ?? 0);
        this._island.setPaused(mode > 0);
    }

    disable() {
        this._cancellable.cancel();
        this._displayConfig?.disconnectObject(this);
        this._displayConfig = null;
        this._music.destroy();
        this._music = null;
        this._island.destroy();
        this._island = null;
        this._settings = null;
    }
}
