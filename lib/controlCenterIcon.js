/*
 * Replaces the stock Quick Settings panel row (wifi/battery/volume/power
 * profile/etc. -- whatever happens to be visible) with a single macOS-style
 * Control Center icon. The real Quick Settings button is untouched and
 * still opens its real dropdown menu on click; only the row of icons
 * normally shown on its face is swapped out.
 *
 * Hides the whole `_indicators` box rather than any specific indicator so
 * this doesn't regress if some other stock icon (bluetooth pairing, night
 * light, etc.) becomes visible later -- it stays hidden along with
 * everything else in that box.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ControlCenterIconController {
    constructor(extensionPath) {
        this._quickSettings = Main.panel.statusArea.quickSettings;
        this._indicatorsBox = this._quickSettings?._indicators ?? null;
        this._wasVisible = this._indicatorsBox?.visible ?? true;
        this._indicatorsBox?.hide();

        const iconPath = GLib.build_filenamev([extensionPath, 'icons', 'panel', 'control-center-white.png']);
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            icon_size: 16,
            style_class: 'system-status-icon',
        });
        this._quickSettings?.insert_child_at_index(this._icon, 0);
    }

    destroy() {
        this._icon?.destroy();
        this._icon = null;

        if (this._indicatorsBox)
            this._indicatorsBox.visible = this._wasVisible;
        this._indicatorsBox = null;
        this._quickSettings = null;
    }
}
