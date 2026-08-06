import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';
import {SoundIndicator} from './lib/soundIndicator.js';
import {MenuManager} from './lib/menuManager.js';
import {ControlCenterIconController} from './lib/controlCenterIcon.js';
import {KiwiMenu} from './src/kiwimenu.js';
import {QuickSettingsActionsController} from './src/hideQSbuttons.js';
import {UserSwitcherController} from './src/userSwitcher.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        try {
            this._kiwiSettings = this.getSettings('org.gnome.shell.extensions.kiwimenu');
            this._globalMenuSettings = this.getSettings('org.gnome.shell.extensions.globalmenu');
            this._panelSettings = this.getSettings('org.gnome.shell.extensions.macos-top-panel');

            this._boxSnapshots = {
                left: snapshotBox(Main.panel._leftBox),
                center: snapshotBox(Main.panel._centerBox),
                right: snapshotBox(Main.panel._rightBox),
            };

            clearBox(Main.panel._leftBox);
            clearBox(Main.panel._centerBox);
            clearBox(Main.panel._rightBox);

            this._kiwiMenu = new KiwiMenu(this._kiwiSettings, this.path, this);
            Main.panel.addToStatusArea('KiwiMenuButton', this._kiwiMenu, 0, 'left');

            this._userSwitcherController = new UserSwitcherController(this);
            this._quickSettingsController = new QuickSettingsActionsController(this._kiwiSettings);

            this._menuManager = new MenuManager(this.uuid, this._globalMenuSettings);
            this._globalMenuChangedId = this._globalMenuSettings.connect('changed', () => {
                this._syncGlobalMenuVisibility();
            });
            global.display.connectObject('notify::focus-window', () => {
                this._syncGlobalMenuVisibility();
            }, this);
            this._syncGlobalMenuVisibility();

            this._batteryIndicator = new BatteryIndicator(this.path);
            Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
            Main.panel._rightBox.add_child(this._batteryIndicator.container);

            this._wifiIndicator = new WifiIndicator();
            Main.panel.menuManager.addMenu(this._wifiIndicator.menu);
            Main.panel._rightBox.add_child(this._wifiIndicator.container);

            this._soundIndicator = new SoundIndicator();
            Main.panel.menuManager.addMenu(this._soundIndicator.menu);
            Main.panel._rightBox.add_child(this._soundIndicator.container);

            // Control Center: reuse the real stock Quick Settings button, just relocated.
            const quickSettings = Main.panel.statusArea.quickSettings;
            quickSettings.container.show();
            Main.panel._rightBox.add_child(quickSettings.container);

            // Replace the stock wifi/battery/etc. icons on its face with a
            // single macOS-style Control Center icon — our own indicators
            // already show battery/wifi/sound.
            this._controlCenterIcon = new ControlCenterIconController(this.path);

            this._clockWidget = new ClockWidget(this._panelSettings);
            Main.panel._rightBox.add_child(this._clockWidget);
        } catch (e) {
            logError(e, '[macos-top-panel] enable() failed, rolling back');
            this.disable();
            throw e;
        }
    }

    _syncGlobalMenuVisibility() {
        if (!this._menuManager)
            return;

        if (this._globalMenuSettings.get_boolean('show-indicator')) {
            let activeWindow = global.display.get_focus_window();
            this._menuManager.updateMenuForWindow(activeWindow);
        } else {
            this._menuManager.clear();
        }
    }

    disable() {
        if (!this._boxSnapshots)
            return;

        global.display.disconnectObject(this);

        if (this._globalMenuChangedId) {
            this._globalMenuSettings.disconnect(this._globalMenuChangedId);
            this._globalMenuChangedId = null;
        }

        this._clockWidget?.destroy();
        this._clockWidget = null;

        this._controlCenterIcon?.destroy();
        this._controlCenterIcon = null;

        // Do NOT destroy quickSettings.container — it's the real stock object,
        // restoreBox() below puts it back where it came from.

        if (this._soundIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._soundIndicator.menu);
        this._soundIndicator?.destroy();
        this._soundIndicator = null;

        if (this._wifiIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator?.destroy();
        this._wifiIndicator = null;

        if (this._batteryIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator?.destroy();
        this._batteryIndicator = null;

        this._menuManager?.destroy();
        this._menuManager = null;

        this._quickSettingsController?.destroy();
        this._quickSettingsController = null;

        this._userSwitcherController?.destroy();
        this._userSwitcherController = null;

        this._kiwiMenu?.destroy();
        this._kiwiMenu = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;

        this._kiwiSettings = null;
        this._globalMenuSettings = null;
        this._panelSettings = null;
    }
}
