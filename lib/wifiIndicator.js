import GObject from 'gi://GObject';
import NM from 'gi://NM';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseWifiState, signalIconName, buildNetworkList} from './wifiData.js';
import {WifiPasswordDialog} from './wifiPasswordDialog.js';

// How often the list re-scans while the dropdown is left open, so a network that just came
// into range (or dropped out) shows up without the user having to close and reopen the menu.
const RESCAN_INTERVAL_SECONDS = 8;

function apIsSecured(ap) {
    if (ap.get_wpa_flags() !== NM.AccessPointSecurityFlags.NONE)
        return true;
    if (ap.get_rsn_flags() !== NM.AccessPointSecurityFlags.NONE)
        return true;
    return !!(ap.get_flags() & NM.AccessPointFlags.PRIVACY);
}

function apSsid(ap) {
    const bytes = ap.get_ssid();
    return bytes ? NM.utils_ssid_to_utf8(bytes.get_data()) : null;
}

export const WifiIndicator = GObject.registerClass(
class WifiIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Wi-Fi');

        this._icon = new St.Icon({icon_name: 'network-wireless-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._foreground = 'white';

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._statusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._toggleItem = new PopupMenu.PopupSwitchMenuItem('Wi-Fi', false);
        this._toggleItem.connect('toggled', (item, state) => {
            if (this._client)
                this._client.wireless_set_enabled(state);
        });
        this.menu.addMenuItem(this._toggleItem);

        this._networksSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._networksSeparator);

        // Scrollable so a dense scan result (apartment buildings, offices) doesn't grow the
        // menu past the screen -- same wrapped-list shape the notification center already
        // uses for its own long content (see notificationCenter.js).
        this._networksScroll = new St.ScrollView({
            style_class: 'wifi-networks-scroll',
            x_expand: true,
        });
        this._networksScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._networksBox = new St.BoxLayout({vertical: true, x_expand: true});
        this._networksScroll.set_child(this._networksBox);
        this._networksScrollItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._networksScrollItem.add_child(this._networksScroll);
        this.menu.addMenuItem(this._networksScrollItem);

        this._emptyItem = new PopupMenu.PopupMenuItem('No networks found', {reactive: false});
        this.menu.addMenuItem(this._emptyItem);

        this._client = null;
        this._device = null;
        this._signalIds = [];
        this._isDestroyed = false;
        this._rescanTimeoutId = 0;
        this._activeDialog = null;

        NM.Client.new_async(null, (source, result) => {
            try {
                const client = NM.Client.new_finish(result);
                // The indicator may already have been destroyed (e.g. the
                // extension was disabled) while this async call was still
                // in flight. Bail out before touching the actor or wiring
                // up signal handlers that would outlive it.
                if (this._isDestroyed)
                    return;
                this._client = client;
                this._signalIds.push(
                    [this._client, this._client.connect('notify::wireless-enabled', () => this._update())]);
                this._signalIds.push(
                    [this._client, this._client.connect('device-added', () => this._trackWifiDevice())]);
                this._trackWifiDevice();
                this._update();
            } catch (e) {
                logError(e, '[macos-top-panel] failed to connect to NetworkManager');
            }
        });

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._onMenuOpened();
            else
                this._onMenuClosed();
        });

        this.connect('destroy', () => {
            this._isDestroyed = true;
            for (const [obj, id] of this._signalIds)
                obj.disconnect(id);
            this._signalIds = [];
            this._client = null;
            this._device = null;
            this._stopRescanTimer();
            this._activeDialog?.close();
            this._activeDialog = null;
        });
    }

    _trackWifiDevice() {
        if (!this._client || this._device)
            return;

        const wifiDevice = this._client.get_devices().find(d => d.get_device_type() === NM.DeviceType.WIFI);
        if (!wifiDevice)
            return;

        this._device = wifiDevice;
        this._signalIds.push(
            [wifiDevice, wifiDevice.connect('notify::active-access-point', () => this._update())]);
        this._signalIds.push(
            [wifiDevice, wifiDevice.connect('access-point-added', () => this._update())]);
        this._signalIds.push(
            [wifiDevice, wifiDevice.connect('access-point-removed', () => this._update())]);
    }

    _currentAccessPoint() {
        return this._device ? this._device.get_active_access_point() : null;
    }

    _update() {
        if (!this._client)
            return;

        const ap = this._currentAccessPoint();
        let ssid = null;
        let strength = null;
        if (ap) {
            ssid = apSsid(ap);
            strength = ap.get_strength();
        }

        const state = parseWifiState({
            wirelessEnabled: this._client.wireless_get_enabled(),
            ssid,
            strength,
        });

        this._icon.icon_name = state.connected
            ? 'network-wireless-signal-excellent-symbolic'
            : 'network-wireless-offline-symbolic';
        this._statusItem.label.text = state.statusLabel;
        this._toggleItem.setToggleState(state.enabled);

        this._renderNetworkList(state.enabled, ssid);
    }

    _renderNetworkList(enabled, activeSsid) {
        this._networksBox.destroy_all_children();

        if (!enabled || !this._device) {
            this._networksSeparator.hide();
            this._networksScrollItem.hide();
            this._emptyItem.hide();
            return;
        }

        this._networksSeparator.show();

        const rawAps = this._device.get_access_points().map(ap => ({
            ssid: apSsid(ap),
            strength: ap.get_strength(),
            secured: apIsSecured(ap),
            ap,
        }));
        const networks = buildNetworkList(rawAps, activeSsid);

        if (networks.length === 0) {
            this._networksScrollItem.hide();
            this._emptyItem.show();
            return;
        }

        this._emptyItem.hide();
        this._networksScrollItem.show();

        for (const network of networks)
            this._networksBox.add_child(this._buildNetworkRow(network));
    }

    _buildNetworkRow(network) {
        const item = new PopupMenu.PopupBaseMenuItem();
        if (network.connected)
            item.setOrnament(PopupMenu.Ornament.CHECK);

        const label = new St.Label({text: network.ssid, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        item.add_child(label);

        if (network.secured) {
            item.add_child(new St.Icon({
                icon_name: 'channel-secure-symbolic', icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-menu-icon',
            }));
        }
        item.add_child(new St.Icon({
            icon_name: signalIconName(network.strength), icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-menu-icon',
        }));

        item.connect('activate', () => {
            if (network.connected)
                return;
            this._connectTo(network.ap, network.secured, network.ssid);
        });

        return item;
    }

    _connectTo(ap, secured, ssid) {
        const knownConnection = this._client.get_connections()
            .find(c => c.get_connection_type() === '802-11-wireless' && ap.connection_valid(c));

        if (knownConnection) {
            this._client.activate_connection_async(knownConnection, this._device, ap.get_path(), null,
                (client, result) => this._onActivateDone(client, result, true));
            return;
        }

        if (!secured) {
            this._client.add_and_activate_connection_async(null, this._device, ap.get_path(), null,
                (client, result) => this._onActivateDone(client, result, false));
            return;
        }

        this._activeDialog?.close();
        const dialog = new WifiPasswordDialog(ssid, password => {
            const connection = new NM.SimpleConnection();

            const sCon = new NM.SettingConnection();
            sCon.set_property(NM.SETTING_CONNECTION_ID, ssid);
            sCon.set_property(NM.SETTING_CONNECTION_TYPE, '802-11-wireless');
            connection.add_setting(sCon);

            const sWifi = new NM.SettingWireless();
            sWifi.set_property(NM.SETTING_WIRELESS_SSID, GLib.Bytes.new(new TextEncoder().encode(ssid)));
            connection.add_setting(sWifi);

            const sSec = new NM.SettingWirelessSecurity();
            sSec.set_property(NM.SETTING_WIRELESS_SECURITY_KEY_MGMT, 'wpa-psk');
            sSec.set_property(NM.SETTING_WIRELESS_SECURITY_PSK, password);
            connection.add_setting(sSec);

            this._client.add_and_activate_connection_async(connection, this._device, ap.get_path(), null,
                (client, result) => this._onActivateDone(client, result, false));
        });
        this._activeDialog = dialog;
        dialog.connect('closed', () => {
            if (this._activeDialog === dialog)
                this._activeDialog = null;
        });
        dialog.open();
    }

    _onActivateDone(client, result, isKnownConnection) {
        try {
            if (isKnownConnection)
                client.activate_connection_finish(result);
            else
                client.add_and_activate_connection_finish(result);
        } catch (e) {
            logError(e, '[macos-top-panel] failed to activate Wi-Fi connection');
            this._activeDialog?.showError('Could not join that network. Check the password and try again.');
            return;
        }
        this._update();
    }

    _onMenuOpened() {
        this._requestScan();
        this._rescanTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RESCAN_INTERVAL_SECONDS, () => {
            this._requestScan();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onMenuClosed() {
        this._stopRescanTimer();
    }

    _stopRescanTimer() {
        if (this._rescanTimeoutId) {
            GLib.source_remove(this._rescanTimeoutId);
            this._rescanTimeoutId = 0;
        }
    }

    _requestScan() {
        if (!this._device || !this._client?.wireless_get_enabled())
            return;
        try {
            this._device.request_scan_async(null, (device, result) => {
                try {
                    device.request_scan_finish(result);
                } catch (e) {
                    // Scan requests fail harmlessly if one is already in flight
                    // (NM throttles to roughly one per few seconds) -- nothing
                    // to surface to the user, the existing AP list just stays put.
                }
            });
        } catch (e) {
            logError(e, '[macos-top-panel] Wi-Fi scan request failed');
        }
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
