// Battery (10): pop-up on plug/unplug, low battery and full charge, from UPower's DisplayDevice.
// `proxy` is public so the System page (Phase 7) can reuse it; `icon` is for the status-bar idle look.
import Gio from 'gi://Gio';
import St from 'gi://St';

const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(`<node><interface name="org.freedesktop.UPower.Device">
  <property name="State" type="u" access="read"/>
  <property name="Percentage" type="d" access="read"/>
  <property name="IsPresent" type="b" access="read"/>
  <property name="IconName" type="s" access="read"/>
  <property name="WarningLevel" type="u" access="read"/>
</interface></node>`);

const CHARGING = 1, FULL = 4, PENDING_CHARGE = 5; // UPower State
const WARNING_LOW = 3; // UPower WarningLevel: 3 low, 4 critical, 5 action

export class BatteryPopup {
    constructor(popups) {
        this._popups = popups;
        this.icon = new St.Icon({style_class: 'revelio-status-icon', visible: false});
        this._cancellable = new Gio.Cancellable();
        DeviceProxy(Gio.DBus.system, 'org.freedesktop.UPower', '/org/freedesktop/UPower/devices/DisplayDevice',
            (proxy, /** @type {any} */ error) => {
                if (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        log(`Revelio: no UPower, battery pop-ups off: ${error.message}`);
                    return;
                }
                this.proxy = proxy;
                this._last = this._read();
                this._syncIcon();
                proxy.connectObject('g-properties-changed', () => this._changed(), this);
            }, this._cancellable, Gio.DBusProxyFlags.DO_NOT_AUTO_START);
    }

    _read() {
        const p = this.proxy;
        return {
            present: !!p.IsPresent,
            plugged: [CHARGING, FULL, PENDING_CHARGE].includes(p.State),
            full: p.State === FULL,
            warning: p.WarningLevel ?? 0,
        };
    }

    _syncIcon() {
        this.icon.visible = !!this.proxy.IsPresent;
        this.icon.icon_name = this.proxy.IconName || 'battery-symbolic';
    }

    _changed() {
        this._syncIcon();
        const now = this._read(), last = this._last;
        this._last = now;
        if (!now.present)
            return; // desktop, or battery removed
        const level = (this.proxy.Percentage ?? 0) / 100;
        const icon = this.proxy.IconName || 'battery-symbolic';
        if (now.plugged !== last.plugged)
            this._popups.show(icon, now.plugged ? 'Charging' : 'On battery', level);
        else if (now.full && !last.full)
            this._popups.show(icon, 'Fully charged', level);
        else if (!now.plugged && now.warning >= WARNING_LOW && now.warning > last.warning)
            this._popups.show('battery-caution-symbolic', 'Low battery', level);
    }

    destroy() {
        this._cancellable.cancel();
        this.proxy?.disconnectObject(this);
        this.proxy = null;
        this.icon.destroy();
    }
}
