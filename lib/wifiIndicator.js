import GObject from 'gi://GObject';
import NM from 'gi://NM';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseWifiState} from './wifiData.js';

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

        this._client = null;
        this._device = null;
        this._signalIds = [];
        this._isDestroyed = false;

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

        this.connect('destroy', () => {
            this._isDestroyed = true;
            for (const [obj, id] of this._signalIds)
                obj.disconnect(id);
            this._signalIds = [];
            this._client = null;
            this._device = null;
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
            const ssidBytes = ap.get_ssid();
            ssid = ssidBytes ? NM.utils_ssid_to_utf8(ssidBytes.get_data()) : null;
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
