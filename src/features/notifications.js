// Notifications (34): other apps' notifications as a pop-up on the closed island (app on the left,
// title on the right), plus a history tab. Pop-ups follow the Shell's own banner rules (Do Not
// Disturb, per-app banners, low urgency); the history keeps those too, so nothing missed during
// Do Not Disturb is lost. Muted apps are left out of both. History is in memory only.
// Apps seen are listed in `notification-apps` so prefs can offer a switch for each.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {ago} from '../lib/ago.js';

const SHOW_MS = 3500;
const MAX_ITEMS = 30;

export class Notifications {
    constructor(island, popups, settings) {
        this._island = island;
        this._popups = popups;
        this._settings = settings;
        this._items = []; // {app, title, body, gicon, at (DateTime), n (live notification or null)}

        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._list,
        });
        this._count = new St.Label({style_class: 'revelio-section-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._clear = new St.Button({style_class: 'revelio-pill revelio-pill-small', can_focus: true, label: 'Clear'});
        this._clear.connect('clicked', () => this._change([]));
        const header = new St.BoxLayout();
        header.add_child(this._count);
        header.add_child(this._clear);
        this.page = new St.BoxLayout({style_class: 'revelio-tasks-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.page.add_child(header);
        this.page.add_child(scroll);
        // Times are relative; refresh them when the page shows instead of on a timer.
        this.page.connectObject('notify::mapped', () => this.page.mapped && this._render(), this);
        island.addPage(this.page, 'Notifications', 'preferences-system-notifications-symbolic');
        this._render();
        settings.connectObject('changed::notification-hide-sender', () => this._render(),
            'changed::notification-hide-text', () => this._render(), this);

        const tray = Main.messageTray;
        tray.connectObject('source-added', (_t, source) => this._watch(source), this);
        tray.getSources().forEach(s => this._watch(s));
    }

    // connectObject drops the handler when the source emits 'destroy'.
    _watch(source) {
        source.connectObject('notification-added', (_s, n) => this._onAdded(source, n), this);
    }

    _onAdded(source, n) {
        const app = source.title ?? '';
        const apps = this._settings.get_strv('notification-apps');
        if (app && !apps.includes(app))
            this._settings.set_strv('notification-apps', [...apps, app]);
        if (this._settings.get_strv('notification-muted-apps').includes(app))
            return;

        // Snapshot the text: the notification may expire (or update) while it's in the history.
        const item = {app, title: n.title ?? '', body: n.body ?? '', gicon: n.gicon ?? source.icon ?? null,
            at: n.datetime ?? GLib.DateTime.new_now_local(), n};
        n.connectObject('destroy', () => {
            item.n = null;
            this._render();
        }, this);
        this._change([item, ...this._items]);

        if (n.acknowledged || n.urgency === MessageTray.Urgency.LOW ||
            (!source.policy.showBanners && n.urgency !== MessageTray.Urgency.CRITICAL))
            return;
        const {sender, icon, text} = this._shown(item);
        this._popups.show(icon ?? 'mail-unread-symbolic', sender, null, {detail: text, ms: SHOW_MS});
    }

    // What the privacy switches allow showing.
    _shown(item) {
        const hideSender = this._settings.get_boolean('notification-hide-sender');
        const hideText = this._settings.get_boolean('notification-hide-text');
        return {
            sender: hideSender ? 'Notification' : item.app,
            icon: hideSender ? null : item.gicon,
            text: hideText ? '' : item.title || item.body,
            body: hideText || !item.title ? '' : item.body,
        };
    }

    _change(items) {
        const kept = items.slice(0, MAX_ITEMS);
        for (const dropped of this._items.filter(i => !kept.includes(i)))
            dropped.n?.disconnectObject(this);
        this._items = kept;
        this._render();
    }

    _render() {
        if (!this._items)
            return; // destroyed
        this._list.destroy_all_children();
        const n = this._items.length;
        this._count.text = n === 1 ? '1 notification' : `${n} notifications`;
        this._clear.visible = n > 0;
        if (!n) {
            this._list.add_child(new St.Label({style_class: 'revelio-dim revelio-empty', text: 'No notifications yet',
                x_align: Clutter.ActorAlign.CENTER}));
            return;
        }
        const now = GLib.DateTime.new_now_local();
        for (const item of this._items) {
            const {sender, icon, text, body} = this._shown(item);
            const head = new St.BoxLayout({style_class: 'revelio-row'});
            head.add_child(new St.Label({style_class: 'revelio-notif-app', text: sender, x_expand: true}));
            head.add_child(new St.Label({style_class: 'revelio-dim revelio-small', text: ago(now.difference(item.at))}));
            const textBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
            textBox.add_child(head);
            for (const [t, cls] of [[text, 'revelio-notif-title'], [body, 'revelio-notif-body revelio-dim']]) {
                if (!t)
                    continue;
                const label = new St.Label({style_class: cls, text: t.replace(/\s+/g, ' ')});
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                textBox.add_child(label);
            }
            const row = new St.BoxLayout({style_class: 'revelio-row', x_expand: true});
            row.add_child(new St.Icon({style_class: 'revelio-notif-icon', y_align: Clutter.ActorAlign.START,
                gicon: icon, fallback_icon_name: 'preferences-system-notifications-symbolic'}));
            row.add_child(textBox);
            // Clicking runs the notification's default action, while the app still has it.
            const open = new St.Button({style_class: 'revelio-notif-open', child: row, can_focus: true, reactive: !!item.n,
                x_expand: true, x_align: Clutter.ActorAlign.FILL});
            open.connect('clicked', () => item.n?.activate());
            const remove = new St.Button({style_class: 'revelio-row-action', can_focus: true, y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: 'window-close-symbolic'})});
            remove.connect('clicked', () => this._change(this._items.filter(i => i !== item)));
            const card = new St.BoxLayout({style_class: 'revelio-list-row revelio-notif', reactive: true, track_hover: true});
            card.add_child(open);
            card.add_child(remove);
            this._list.add_child(card);
        }
    }

    destroy() {
        Main.messageTray.disconnectObject(this);
        Main.messageTray.getSources().forEach(s => s.disconnectObject(this));
        this._items.forEach(i => i.n?.disconnectObject(this));
        this._items = null;
        this._settings.disconnectObject(this);
        this.page.disconnectObject(this);
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
