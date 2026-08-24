import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {BluetoothController} from './bluetoothController.js';

// How often the device list re-reads BlueZ's state while the dropdown is open -- catches a
// device connecting/disconnecting (from either side) without needing a live property-watch
// proxy per device (see BluetoothController.refresh()'s own comment for why).
const REFRESH_INTERVAL_SECONDS = 5;

export const BluetoothIndicator = GObject.registerClass(
class BluetoothIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Bluetooth');

        this._icon = new St.Icon({icon_name: 'bluetooth-active-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._foreground = 'white';

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._statusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._toggleItem = new PopupMenu.PopupSwitchMenuItem('Bluetooth', false);
        this._toggleItem.connect('toggled', () => this._controller.toggle());
        this.menu.addMenuItem(this._toggleItem);

        this._devicesSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._devicesSeparator);

        // Scrollable for the same reason as the Wi-Fi network list (see wifiIndicator.js) --
        // a house full of paired gear plus a live scan shouldn't grow this menu past the
        // screen.
        this._devicesScroll = new St.ScrollView({style_class: 'wifi-networks-scroll', x_expand: true});
        this._devicesScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._devicesBox = new St.BoxLayout({vertical: true, x_expand: true});
        this._devicesScroll.set_child(this._devicesBox);
        this._devicesScrollItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._devicesScrollItem.add_child(this._devicesScroll);
        this.menu.addMenuItem(this._devicesScrollItem);

        this._emptyItem = new PopupMenu.PopupMenuItem('No devices found', {reactive: false});
        this.menu.addMenuItem(this._emptyItem);

        this._powered = false;
        this._busyPaths = new Set();
        this._refreshTimeoutId = 0;

        this._controller = new BluetoothController(
            state => this._update(state),
            devices => this._renderDeviceList(devices));

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._controller.startDiscovery();
                this._refreshTimeoutId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
                        this._controller.refresh();
                        return GLib.SOURCE_CONTINUE;
                    });
            } else {
                this._controller.stopDiscovery();
                if (this._refreshTimeoutId) {
                    GLib.source_remove(this._refreshTimeoutId);
                    this._refreshTimeoutId = 0;
                }
            }
        });

        this.connect('destroy', () => {
            if (this._refreshTimeoutId) {
                GLib.source_remove(this._refreshTimeoutId);
                this._refreshTimeoutId = 0;
            }
            this._controller.destroy();
        });
    }

    _update(state) {
        this._powered = state.powered;
        this._icon.icon_name = state.powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
        this._statusItem.label.text = state.statusLabel;
        this._toggleItem.setToggleState(state.powered);

        this._devicesSeparator.visible = state.powered;
        this._devicesScrollItem.visible = state.powered;
        this._emptyItem.visible = false; // reset until the next _renderDeviceList() call decides
        if (!state.powered)
            this._devicesBox.destroy_all_children();
    }

    _renderDeviceList(devices) {
        this._devicesBox.destroy_all_children();

        if (!this._powered) {
            this._devicesScrollItem.hide();
            this._emptyItem.hide();
            return;
        }

        if (devices.length === 0) {
            this._devicesScrollItem.hide();
            this._emptyItem.show();
            return;
        }

        this._emptyItem.hide();
        this._devicesScrollItem.show();

        for (const device of devices)
            this._devicesBox.add_child(this._buildDeviceRow(device));
    }

    _buildDeviceRow(device) {
        const item = new PopupMenu.PopupBaseMenuItem();
        if (device.connected)
            item.setOrnament(PopupMenu.Ornament.CHECK);

        const label = new St.Label({
            text: device.name ?? 'Unknown Device',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (!device.name)
            label.add_style_class_name('dim-label');
        item.add_child(label);

        const busy = this._busyPaths.has(device.path);
        if (busy) {
            const spinner = new St.Icon({
                icon_name: 'content-loading-symbolic', icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-menu-icon',
            });
            item.add_child(spinner);
        } else {
            const statusLabel = new St.Label({
                text: device.connected ? 'Connected' : (device.paired ? 'Paired' : ''),
                style_class: 'popup-menu-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (statusLabel.text)
                item.add_child(statusLabel);
        }

        item.reactive = !busy;
        item.connect('activate', () => {
            if (this._busyPaths.has(device.path))
                return;
            this._toggleDevice(device);
        });

        return item;
    }

    _toggleDevice(device) {
        this._busyPaths.add(device.path);
        const finish = () => {
            this._busyPaths.delete(device.path);
            this._controller.refresh();
        };

        if (device.connected)
            this._controller.disconnectDevice(device.path, finish);
        else
            this._controller.connectDevice(device.path, finish);
    }

    /**
     * @param {'black'|'white'} foreground
     */
    setForeground(foreground) {
        if (foreground !== 'black' && foreground !== 'white')
            return;
        this._foreground = foreground;
        this._icon.style = `color: ${foreground};`;
    }
});
