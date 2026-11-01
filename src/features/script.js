// Script reader (37): a teleprompter page for a .txt chosen in prefs, or text pasted with the
// paste button. Scrolls at `script-wpm` words per minute with a Clutter transition (no timer of
// ours). Click the text to give it the keys: Space plays/pauses, arrows move back and forth.
// ponytail: pasted text lives in memory only; persist it if people want it back after log-out.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

const MAX_BYTES = 1 << 20; // a teleprompter script, not a log file
const STEP_PX = 40;

export class Script {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._words = 0;

        this._label = new St.Label({style_class: 'revelio-script-text', x_expand: true});
        this._label.clutter_text.line_wrap = true;
        const content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        content.add_child(this._label);
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            child: content,
        });
        const button = (icon, action) => {
            const b = new St.Button({style_class: 'revelio-media-button', can_focus: true, child: new St.Icon({icon_name: icon})});
            b.connect('clicked', action);
            return b;
        };
        this._playButton = button('media-playback-start-symbolic', () => this._toggle());
        const buttons = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
        buttons.add_child(this._playButton);
        buttons.add_child(button('media-skip-backward-symbolic', () => this._move(-Infinity)));
        buttons.add_child(button('edit-paste-symbolic', () => St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,
            (_c, text) => text && this._setText(text))));

        this.page = new St.BoxLayout({style_class: 'revelio-script-page', x_expand: true, reactive: true, can_focus: true});
        this.page.add_child(this._scroll);
        this.page.add_child(buttons);
        this.page.connectObject(
            'button-press-event', () => {
                island.grabKeys(this.page);
                return Clutter.EVENT_PROPAGATE;
            },
            'key-press-event', (_a, event) => this._onKey(event.get_key_symbol()),
            'notify::mapped', () => !this.page.mapped && this._pause(),
            this);
        island.addPage(this.page, 'Script', 'x-office-document-symbolic');

        settings.connectObject('changed::script-file', () => this._load(), 'changed::script-wpm', () => {
            if (this._playing())
                this._play();
        }, this);
        this._load();
    }

    _load() {
        const path = this._settings.get_string('script-file');
        if (!path) {
            this._setText('');
            return;
        }
        Gio.File.new_for_path(path).load_contents_async(this._cancellable, (file, res) => {
            try {
                const [, bytes] = file.load_contents_finish(res);
                this._setText(bytes.length > MAX_BYTES ? 'This file is too big for the script reader (1 MB max).'
                    : new TextDecoder().decode(bytes));
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    this._setText(`Can't read ${path}: ${e.message}`);
            }
        });
    }

    _setText(text) {
        this._pause();
        this._label.text = text.trim() || 'Choose a .txt in Revelio settings, or paste text with the button on the right.';
        this._words = text.split(/\s+/).filter(Boolean).length;
        this._scroll.vadjustment.value = 0;
    }

    _playing() {
        return !!this._scroll.vadjustment.get_transition('value');
    }

    _onKey(key) {
        if (key === Clutter.KEY_space)
            this._toggle();
        else if (key === Clutter.KEY_Up || key === Clutter.KEY_Left)
            this._move(-STEP_PX);
        else if (key === Clutter.KEY_Down || key === Clutter.KEY_Right)
            this._move(STEP_PX);
        else
            return Clutter.EVENT_PROPAGATE; // Escape closes the island
        return Clutter.EVENT_STOP;
    }

    _toggle() {
        if (this._playing())
            this._pause();
        else
            this._play();
    }

    // Speed from the text's height: pixels per word times words per second.
    _play() {
        const adj = this._scroll.vadjustment;
        const end = adj.upper - adj.page_size;
        if (!this._words || end <= 0)
            return;
        if (adj.value >= end)
            adj.value = 0; // finished: start over
        const pxPerSec = adj.upper / this._words * this._settings.get_uint('script-wpm') / 60;
        adj.ease(end, {
            duration: (end - adj.value) / pxPerSec * 1000,
            mode: Clutter.AnimationMode.LINEAR,
            onStopped: () => this._syncButton(false),
        });
        this._syncButton();
    }

    _pause() {
        this._scroll.vadjustment.remove_transition('value');
        this._syncButton();
    }

    _move(px) {
        const playing = this._playing();
        this._pause();
        const adj = this._scroll.vadjustment;
        adj.value = Math.max(0, Math.min(adj.upper - adj.page_size, adj.value + px));
        if (playing)
            this._play();
    }

    _syncButton(playing = this._playing()) {
        /** @type {St.Icon} */ (this._playButton.child).icon_name =
            playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    }

    destroy() {
        this._cancellable.cancel();
        this._settings.disconnectObject(this);
        this._pause();
        this._island.removePage(this.page);
        this.page.destroy();
    }
}
