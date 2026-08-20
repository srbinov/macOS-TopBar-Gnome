import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';
import {BluetoothIndicator} from './lib/bluetoothIndicator.js';
import {SearchIndicator} from './lib/searchIndicator.js';
import {installDashFilter, uninstallDashFilter} from './lib/dashFilter.js';
import {installNotificationSlide, uninstallNotificationSlide} from './lib/notificationTray.js';
import {NotificationCenterPanel} from './lib/notificationCenter.js';
import {AppLauncherOverlay} from './lib/appLauncher.js';
import {DockOrderGuard} from './lib/dockOrderGuard.js';
import {SoundIndicator} from './lib/soundIndicator.js';
import {MenuManager} from './lib/menuManager.js';
import {ControlCenterIndicator} from './lib/controlCenterIndicator.js';
import {WindowColorBlend} from './lib/windowColorBlend.js';
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

            // St.BoxLayout's own "spacing" property adds a gap between every direct child,
            // independent of and in addition to each icon's own CSS margin/padding -- a CSS
            // rule on .system-status-icon alone can't touch this, since it's a property of
            // the *box*, not the icons in it. Zeroed out so the icon-level margin/padding
            // (see stylesheet.css) is the one and only thing controlling the visible gap.
            this._rightBoxOriginalSpacing = Main.panel._rightBox.spacing;
            Main.panel._rightBox.spacing = 0;

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

            this._batteryIndicator = new BatteryIndicator(this.path, this._panelSettings);
            Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
            Main.panel._rightBox.add_child(this._batteryIndicator.container);

            this._wifiIndicator = new WifiIndicator();
            Main.panel.menuManager.addMenu(this._wifiIndicator.menu);
            Main.panel._rightBox.add_child(this._wifiIndicator.container);

            this._bluetoothIndicator = new BluetoothIndicator();
            Main.panel.menuManager.addMenu(this._bluetoothIndicator.menu);
            Main.panel._rightBox.add_child(this._bluetoothIndicator.container);

            this._searchIndicator = new SearchIndicator();
            Main.panel._rightBox.add_child(this._searchIndicator.container);
            installDashFilter();

            installNotificationSlide(Main.messageTray);

            this._soundIndicator = new SoundIndicator();
            Main.panel.menuManager.addMenu(this._soundIndicator.menu);
            Main.panel._rightBox.add_child(this._soundIndicator.container);

            this._controlCenter = new ControlCenterIndicator(this.path);
            Main.panel.menuManager.addMenu(this._controlCenter.menu);
            Main.panel._rightBox.add_child(this._controlCenter.container);

            this._notificationCenter = new NotificationCenterPanel();
            this._clockWidget = new ClockWidget(this._panelSettings, () => this._notificationCenter.toggle());
            Main.panel._rightBox.add_child(this._clockWidget);

            // Launchpad-style app grid, triggered from a Dock icon (peachos-applauncher.desktop)
            // over D-Bus rather than a panel widget -- see lib/appLauncher.js.
            this._appLauncher = new AppLauncherOverlay();

            // peachos-icon-appearance (Settings > Appearance > icon style) snapshots/restores
            // the dock's actual app order around its bulk icon swap over D-Bus -- see
            // lib/dockOrderGuard.js for why this has to live here, in the Shell process.
            this._dockOrderGuard = new DockOrderGuard();

            this._blendColor = null;
            this._panelForeground = 'white';
            this._windowColorBlend = new WindowColorBlend(
                () => this._panelRect(),
                ({blendColor, foreground}) => {
                    this._blendColor = blendColor;
                    this._panelForeground = foreground;
                    this._applyPanelStyle();
                    this._applyPanelForeground(foreground);
                });
            this._windowColorBlend.enable();

            this._panelSettingsChangedId = this._panelSettings.connect('changed', (_settings, key) => {
                if (key === 'panel-height' || key === 'window-color-blend-enabled')
                    this._applyPanelStyle();
                else if (key.startsWith('show-') && key.endsWith('-icon'))
                    this._applyIconVisibility();
            });
            this._applyPanelStyle();
            this._applyPanelForeground(this._panelForeground);
            this._applyIconVisibility();

            // Auto-hide in full screen: driven entirely by our own code (not relying on
            // whatever Mutter/Shell might otherwise do to Main.panel in full screen), so
            // "never hide" is just as deterministic as "hide" -- both states are actively
            // asserted on every fullscreen change, not just the hiding one.
            //
            // Isolated in its own try/catch, unlike everything above: this is the newest,
            // least field-tested piece (Main.layoutManager.primaryMonitor.inFullscreen isn't
            // exercised by anything else in this file), and a failure here shouldn't be able
            // to roll back the whole panel replacement the way a single unrelated bug already
            // did once (see the search/wifi/bluetooth icon-visibility fix above).
            try {
                this._panelHidden = false;
                this._fullscreenChangedId = global.display.connect('in-fullscreen-changed', () => {
                    this._applyFullscreenState();
                });
                // Belt-and-suspenders alongside the signal above: it didn't reliably trigger
                // the slide in testing (window-color-blend's own, separate window-touching-panel
                // detection *did* still visibly react to the full-screen window, which is what
                // made "the bar doesn't slide, colors just change" so confusing -- two unrelated
                // features, only one of them actually firing). This just re-checks the same
                // cheap boolean property every second; _applyFullscreenState() already no-ops
                // when nothing changed, so this costs nothing extra when idle. Not remotely the
                // same risk as the earlier wl-paste polling incident -- that spawned a new
                // process/Wayland connection every tick, this reads one in-memory property,
                // the same cost class as the clock's own existing 1s timer.
                this._fullscreenPollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                    this._applyFullscreenState();
                    return GLib.SOURCE_CONTINUE;
                });
                this._applyFullscreenState();
            } catch (e) {
                logError(e, '[macos-top-panel] full screen auto-hide setup failed, leaving the panel always shown');
            }
        } catch (e) {
            logError(e, '[macos-top-panel] enable() failed, rolling back');
            this.disable();
            throw e;
        }
    }

    _panelRect() {
        const [x, y] = Main.panel.get_transformed_position();
        const [width, height] = Main.panel.get_transformed_size();
        return {x, y, width, height};
    }

    _applyPanelStyle() {
        const declarations = [];

        const height = this._panelSettings.get_int('panel-height');
        if (height > 0)
            declarations.push(`height: ${height}px`);

        const blendEnabled = this._panelSettings.get_boolean('window-color-blend-enabled');
        const showGlass = blendEnabled && !!this._blendColor;
        if (showGlass)
            declarations.push(`background-color: ${this._blendColor}`);

        const fg = this._panelForeground === 'black' ? 'black' : 'white';
        declarations.push(`color: ${fg}`);

        Main.panel.style = declarations.length ? `${declarations.join('; ')};` : null;

        // Liquid glass rim + top inset highlight (stylesheet.css's .macos-panel-glass) only
        // while a window is actually touching the bar and blend is supplying a translucent
        // tint (see windowColorBlend.js) via the inline background-color above -- with
        // nothing touching, the bar stays exactly as fully transparent as the stock theme's
        // own #panel rule, no rim, no fill, per explicit request.
        if (showGlass)
            Main.panel.add_style_class_name('macos-panel-glass');
        else
            Main.panel.remove_style_class_name('macos-panel-glass');

        Main.panel.remove_style_class_name('macos-panel-fg-black');
        Main.panel.remove_style_class_name('macos-panel-fg-white');
        Main.panel.add_style_class_name(
            this._panelForeground === 'black' ? 'macos-panel-fg-black' : 'macos-panel-fg-white');
    }

    /**
     * Push contrast color into widgets that don’t inherit panel `color`
     * (PNG face icons, explicit clock styles, kiwi SVG gicons).
     * @param {'black'|'white'} foreground
     */
    _applyPanelForeground(foreground) {
        this._kiwiMenu?.setForeground?.(foreground);
        this._batteryIndicator?.setForeground?.(foreground);
        this._controlCenter?.setForeground?.(foreground);
        this._clockWidget?.setForeground?.(foreground);
        this._wifiIndicator?.setForeground?.(foreground);
        this._bluetoothIndicator?.setForeground?.(foreground);
        this._searchIndicator?.setForeground?.(foreground);
        this._soundIndicator?.setForeground?.(foreground);
        this._userSwitcherController?.setForeground?.(foreground);
    }

    _applyIconVisibility() {
        // .show()/.hide() called directly on each indicator, not via ".container" -- that
        // broke with "this._searchIndicator.container.set_visible is not a function" for the
        // dontCreateMenu=true SearchIndicator specifically (PanelMenu.Button's container
        // apparently isn't a plain actor in that case), and since it threw partway through
        // enable(), the whole extension rolled back (including dashFilter.js's fix), which is
        // also why the dock icon came back. The indicators themselves are actors (they extend
        // PanelMenu.Button -> St.Widget), so show()/hide() work directly and uniformly
        // regardless of whether a menu exists -- same pattern BatteryIndicator already used.
        if (this._panelSettings.get_boolean('show-spotlight-icon'))
            this._searchIndicator?.show();
        else
            this._searchIndicator?.hide();

        if (this._panelSettings.get_boolean('show-wifi-icon'))
            this._wifiIndicator?.show();
        else
            this._wifiIndicator?.hide();

        if (this._panelSettings.get_boolean('show-bluetooth-icon'))
            this._bluetoothIndicator?.show();
        else
            this._bluetoothIndicator?.hide();

        // BatteryIndicator manages its own visibility (it already needed to, for the "no real
        // battery on this machine" case) -- it listens for show-battery-icon itself instead of
        // being toggled from here, so a battery property change firing _update() later can't
        // silently override the user's preference by calling its own this.show() again.
    }

    /**
     * Slide the panel off/on screen for full-screen auto-hide. Pure visual transform (not a
     * work-area/strut change) -- a full-screen window already covers this area regardless, so
     * this is about the panel not visibly floating on top of it, not about reclaiming layout
     * space for other windows.
     */
    _applyFullscreenState() {
        const autoHide = this._panelSettings.get_boolean('auto-hide-in-fullscreen');
        const isFullscreen = Main.layoutManager.primaryMonitor?.inFullscreen ?? false;
        const shouldHide = autoHide && isFullscreen;

        if (shouldHide === this._panelHidden)
            return;
        this._panelHidden = shouldHide;

        // Main.panel.height is Clutter's fixed-size override property, not necessarily the
        // panel's actual rendered height (it's usually unset, sized by theme/CSS instead) --
        // reuse _panelRect()'s get_transformed_size(), the same real-size source the
        // color-blend sampling already relies on, rather than trust that property directly.
        const height = this._panelRect().height || 32;
        Main.panel.ease({
            translation_y: shouldHide ? -height : 0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
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

        if (this._panelSettingsChangedId) {
            this._panelSettings.disconnect(this._panelSettingsChangedId);
            this._panelSettingsChangedId = null;
        }

        if (this._fullscreenChangedId) {
            global.display.disconnect(this._fullscreenChangedId);
            this._fullscreenChangedId = null;
        }
        if (this._fullscreenPollId) {
            GLib.source_remove(this._fullscreenPollId);
            this._fullscreenPollId = null;
        }
        Main.panel.remove_all_transitions();
        Main.panel.translation_y = 0;
        this._panelHidden = false;

        this._windowColorBlend?.disable();
        this._windowColorBlend = null;
        this._blendColor = null;
        this._panelForeground = null;
        Main.panel.remove_style_class_name('macos-panel-fg-black');
        Main.panel.remove_style_class_name('macos-panel-fg-white');
        Main.panel.remove_style_class_name('macos-panel-glass');
        Main.panel.style = null;

        this._clockWidget?.destroy();
        this._clockWidget = null;

        this._notificationCenter?.destroy();
        this._notificationCenter = null;

        this._appLauncher?.destroy();
        this._appLauncher = null;

        this._dockOrderGuard?.destroy();
        this._dockOrderGuard = null;

        if (this._controlCenter?.menu)
            Main.panel.menuManager.removeMenu(this._controlCenter.menu);
        this._controlCenter?.destroy();
        this._controlCenter = null;

        if (this._soundIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._soundIndicator.menu);
        this._soundIndicator?.destroy();
        this._soundIndicator = null;

        // dontCreateMenu=true, so there's no this._searchIndicator.menu to remove.
        this._searchIndicator?.destroy();
        this._searchIndicator = null;
        uninstallDashFilter();
        uninstallNotificationSlide();

        if (this._wifiIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator?.destroy();
        this._wifiIndicator = null;

        if (this._bluetoothIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._bluetoothIndicator.menu);
        this._bluetoothIndicator?.destroy();
        this._bluetoothIndicator = null;

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

        if (this._rightBoxOriginalSpacing !== undefined) {
            Main.panel._rightBox.spacing = this._rightBoxOriginalSpacing;
            this._rightBoxOriginalSpacing = undefined;
        }

        this._kiwiSettings = null;
        this._globalMenuSettings = null;
        this._panelSettings = null;
    }
}
