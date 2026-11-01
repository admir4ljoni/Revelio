import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Island} from './src/island.js';
import {Music} from './src/features/music.js';
import {Popups} from './src/popups.js';
import {VolumePopup} from './src/features/volume.js';
import {BatteryPopup} from './src/features/battery.js';
import {HeadphonesPopup} from './src/features/headphones.js';
import {Focus} from './src/features/focus.js';
import {Tasks} from './src/features/tasks.js';
import {Today} from './src/features/today.js';
import {Shelf} from './src/features/shelf.js';

export default class RevelioExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._island = new Island(this._settings);
        this._music = new Music(this._island);
        this._popups = new Popups(this._island);
        const volume = new VolumePopup(this._popups), battery = new BatteryPopup(this._popups);
        this._popupFeatures = [volume, battery, new HeadphonesPopup(this._popups)];
        this._island.setStatus(volume.icon, battery.icon);
        this._tabs = [new Focus(this._island, this._settings), new Tasks(this._island),
            new Today(this._island, this._settings), new Shelf(this._island)];

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
        this._tabs.forEach(f => f.destroy());
        this._tabs = null;
        this._island.setStatus(null, null);
        this._popupFeatures.forEach(f => f.destroy());
        this._popupFeatures = null;
        this._popups.destroy();
        this._popups = null;
        this._music.destroy();
        this._music = null;
        this._island.destroy();
        this._island = null;
        this._settings = null;
    }
}
