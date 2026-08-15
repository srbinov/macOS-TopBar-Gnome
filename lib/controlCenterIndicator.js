// lib/controlCenterIndicator.js
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {WifiTileController} from './wifiTileController.js';
import {BluetoothController} from './bluetoothController.js';
import {ScreenMirroringController} from './screenMirroringController.js';
import {FocusController} from './focusController.js';

export const ControlCenterIndicator = GObject.registerClass(
class ControlCenterIndicator extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.5, 'Control Center');

        const iconPath = GLib.build_filenamev([extensionPath, 'icons', 'panel', 'control-center-white.png']);
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            icon_size: 16,
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();

        this._wifi = new WifiTileController(state => this._updateWifi(state));
        this._bluetooth = new BluetoothController(state => this._updateBluetooth(state));
        this._screenMirroring = new ScreenMirroringController(state => this._updateScreenMirroring(state));
        this._focus = new FocusController(state => this._updateFocus(state));

        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenMirroring.destroy();
            this._focus.destroy();
        });
    }

    _buildMenu() {
        this.menu.actor?.add_style_class_name('macos-control-center-menu');

        const root = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});

        this._container = new St.BoxLayout({
            vertical: true,
            style_class: 'macos-control-center-column',
            x_expand: true,
        });
        root.add_child(this._container);

        this._topRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        this._container.add_child(this._topRow);

        this._leftColumn = new St.BoxLayout({
            vertical: true,
            style_class: 'macos-control-center-column',
            x_expand: true,
            y_expand: true,
        });
        this._topRow.add_child(this._leftColumn);

        this._wifiPill = this._createPill('network-wireless-symbolic', 'Wi-Fi', '', () => this._wifi.toggle());
        this._leftColumn.add_child(this._wifiPill.actor);

        this._circleRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        this._leftColumn.add_child(this._circleRow);

        this._bluetoothCircle = this._createCircleButton('bluetooth-active-symbolic', () => this._bluetooth.toggle());
        this._circleRow.add_child(this._bluetoothCircle.button);

        this._mirrorCircle = this._createCircleButton('screen-shared-symbolic', () => this._screenMirroring.toggle());
        this._circleRow.add_child(this._mirrorCircle.button);

        this._focusPill = this._createPill('weather-clear-night-symbolic', 'Focus', '', () => this._focus.toggle());
        this._focusPill.actor.add_style_class_name('macos-control-center-focus-pill');
        this._container.add_child(this._focusPill.actor);

        this.menu.addMenuItem(root);
    }

    _createPill(iconName, title, subtitle, onActivate) {
        const button = new St.Button({
            style_class: 'macos-control-center-pill',
            reactive: true,
            can_focus: true,
            x_expand: true,
        });
        button.connect('clicked', onActivate);

        const content = new St.BoxLayout({style_class: 'macos-control-center-row'});
        button.set_child(content);

        const badge = new St.Bin({
            style_class: 'macos-control-center-pill-icon-badge',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        badge.set_child(new St.Icon({icon_name: iconName}));
        content.add_child(badge);

        const textColumn = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        content.add_child(textColumn);

        const titleLabel = new St.Label({text: title, style_class: 'macos-control-center-pill-title'});
        textColumn.add_child(titleLabel);

        const subtitleLabel = new St.Label({text: subtitle, style_class: 'macos-control-center-pill-subtitle'});
        textColumn.add_child(subtitleLabel);

        return {actor: button, titleLabel, subtitleLabel};
    }

    _createCircleButton(iconName, onActivate) {
        const button = new St.Button({
            style_class: 'macos-control-center-circle-button',
            reactive: true,
            can_focus: true,
        });
        button.connect('clicked', onActivate);

        const icon = new St.Icon({icon_name: iconName, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        button.set_child(icon);

        return {button, icon};
    }

    _updateWifi(state) {
        this._wifiPill.subtitleLabel.text = state.statusLabel;
        if (state.enabled)
            this._wifiPill.actor.add_style_class_name('on');
        else
            this._wifiPill.actor.remove_style_class_name('on');
    }

    _updateBluetooth(state) {
        this._bluetoothCircle.button.tooltip_text = state.connectedDeviceName ?? '';
        if (state.powered)
            this._bluetoothCircle.button.add_style_class_name('on');
        else
            this._bluetoothCircle.button.remove_style_class_name('on');
    }

    _updateScreenMirroring(state) {
        if (state.enabled)
            this._mirrorCircle.button.add_style_class_name('on');
        else
            this._mirrorCircle.button.remove_style_class_name('on');
    }

    _updateFocus(state) {
        if (state.enabled)
            this._focusPill.actor.add_style_class_name('on');
        else
            this._focusPill.actor.remove_style_class_name('on');
    }
});
