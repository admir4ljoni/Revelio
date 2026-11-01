// Headphones (11): pop-up when a Bluetooth audio device connects, with its battery when BlueZ
// reports one. Battery1 often appears a moment after Connected, so it re-shows the pop-up then.
import Gio from 'gi://Gio';

const DEVICE = 'org.bluez.Device1', BATTERY = 'org.bluez.Battery1';

export class HeadphonesPopup {
    constructor(popups) {
        this._popups = popups;
        this._cancellable = new Gio.Cancellable();
        Gio.DBusObjectManagerClient.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusObjectManagerClientFlags.DO_NOT_AUTO_START,
            'org.bluez', '/', null, this._cancellable, (_o, res) => {
                try {
                    this._manager = Gio.DBusObjectManagerClient.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        log(`Revelio: no BlueZ, headphone pop-ups off: ${e.message}`);
                    return;
                }
                this._manager.connectObject(
                    'interface-proxy-properties-changed', (_m, object, iface, changed) => {
                        if (iface.g_interface_name === DEVICE && changed.lookup_value('Connected', null)?.unpack())
                            this._show(object);
                    },
                    'interface-added', (_m, object, iface) => {
                        if (iface.g_interface_name === BATTERY)
                            this._show(object);
                    },
                    this);
            });
    }

    _show(object) {
        const device = /** @type {Gio.DBusProxy} */ (object.get_interface(DEVICE));
        const get = name => device?.get_cached_property(name)?.unpack();
        if (!get('Connected') || !String(get('Icon') ?? '').startsWith('audio-'))
            return;
        const battery = /** @type {Gio.DBusProxy} */ (object.get_interface(BATTERY));
        const pct = battery?.get_cached_property('Percentage')?.unpack();
        this._popups.show(get('Icon') === 'audio-headset' ? 'audio-headset-symbolic' : 'audio-headphones-symbolic',
            get('Alias') ?? get('Name') ?? 'Headphones', pct === undefined ? null : Number(pct) / 100);
    }

    destroy() {
        this._cancellable.cancel();
        this._manager?.disconnectObject(this);
        this._manager = null;
    }
}
