import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {ModalDialog} from 'resource:///org/gnome/shell/ui/modalDialog.js';

// Real macOS pops a real modal sheet for a secured network's password, not an inline
// popup-menu row -- a plain PopupMenu item also can't reliably keep keyboard focus once the
// user starts typing while the surrounding PanelMenu.Button menu is still open, and closing
// that outer menu first (to avoid the fight) would lose the click that opened this in the
// first place. ModalDialog is GNOME Shell's own stock mechanism for exactly this (it's what
// backs the network secrets agent's own password prompt) -- self-contained, handles Escape
// and outside-click cancellation, and doesn't require this extension to implement any of
// that itself.
export const WifiPasswordDialog = GObject.registerClass(
class WifiPasswordDialog extends ModalDialog {
    /**
     * @param {string} ssid
     * @param {(password: string) => void} onSubmit
     */
    _init(ssid, onSubmit) {
        super._init({styleClass: 'wifi-password-dialog'});
        this._onSubmit = onSubmit;

        const content = new St.BoxLayout({vertical: true, style_class: 'wifi-password-content'});

        content.add_child(new St.Label({
            text: `Enter the password for “${ssid}”`,
            style_class: 'wifi-password-title',
        }));
        content.add_child(new St.Label({
            text: 'This network requires a password to join.',
            style_class: 'wifi-password-subtitle',
        }));

        this._entry = new St.PasswordEntry({
            can_focus: true,
            style_class: 'wifi-password-entry',
            x_expand: true,
        });
        this._entry.clutter_text.connect('activate', () => this._submit());
        content.add_child(this._entry);

        this._errorLabel = new St.Label({style_class: 'wifi-password-error', visible: false});
        content.add_child(this._errorLabel);

        this.contentLayout.add_child(content);

        this.setButtons([
            {
                label: 'Cancel',
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: 'Join',
                action: () => this._submit(),
                default: true,
            },
        ]);

        this.connect('opened', () => this._entry.grab_key_focus());
    }

    _submit() {
        const password = this._entry.get_text();
        if (!password)
            return;
        this._onSubmit(password);
        this.close();
    }

    showError(message) {
        this._errorLabel.text = message;
        this._errorLabel.visible = true;
    }
});
