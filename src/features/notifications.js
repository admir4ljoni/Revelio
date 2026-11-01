// Notifications (34): other apps' notifications as a pop-up on the closed island (app on the left,
// title on the right). Follows the Shell's own banner rules (Do Not Disturb, per-app banners, low
// urgency). Apps seen are listed in `notification-apps` so prefs can offer a switch for each.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const SHOW_MS = 3500;

export class Notifications {
    constructor(popups, settings) {
        this._popups = popups;
        this._settings = settings;
        const tray = Main.messageTray;
        tray.connectObject('source-added', (_t, source) => this._watch(source), this);
        tray.getSources().forEach(s => this._watch(s));
    }

    // connectObject drops the handler when the source emits 'destroy'.
    _watch(source) {
        source.connectObject('notification-added', (_s, n) => this._show(source, n), this);
    }

    _show(source, n) {
        const app = source.title ?? '';
        const apps = this._settings.get_strv('notification-apps');
        if (app && !apps.includes(app))
            this._settings.set_strv('notification-apps', [...apps, app]);
        if (n.acknowledged || n.urgency === MessageTray.Urgency.LOW ||
            (!source.policy.showBanners && n.urgency !== MessageTray.Urgency.CRITICAL) ||
            this._settings.get_strv('notification-muted-apps').includes(app))
            return;
        const hideSender = this._settings.get_boolean('notification-hide-sender');
        const hideText = this._settings.get_boolean('notification-hide-text');
        const text = hideText ? '' : n.title || n.body || '';
        this._popups.show(hideSender ? 'mail-unread-symbolic' : n.gicon ?? source.icon ?? 'mail-unread-symbolic',
            hideSender ? 'Notification' : app, null, {detail: text, ms: SHOW_MS});
    }

    destroy() {
        Main.messageTray.disconnectObject(this);
        Main.messageTray.getSources().forEach(s => s.disconnectObject(this));
    }
}
