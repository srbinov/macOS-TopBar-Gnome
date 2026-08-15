import NM from 'gi://NM';

import {parseWifiState} from './wifiData.js';

export class WifiTileController {
    constructor(onChange) {
        this._onChange = onChange;
        this._client = null;
        this._device = null;
        this._signalIds = [];
        this._isDestroyed = false;

        NM.Client.new_async(null, (source, result) => {
            try {
                const client = NM.Client.new_finish(result);
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
                logError(e, '[macos-top-panel] control center: failed to connect to NetworkManager');
            }
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

    _update() {
        if (!this._client)
            return;

        const ap = this._device ? this._device.get_active_access_point() : null;
        let ssid = null;
        let strength = null;
        if (ap) {
            const ssidBytes = ap.get_ssid();
            ssid = ssidBytes ? NM.utils_ssid_to_utf8(ssidBytes.get_data()) : null;
            strength = ap.get_strength();
        }

        this._onChange(parseWifiState({wirelessEnabled: this._client.wireless_get_enabled(), ssid, strength}));
    }

    toggle() {
        if (this._client)
            this._client.wireless_set_enabled(!this._client.wireless_get_enabled());
    }

    destroy() {
        this._isDestroyed = true;
        for (const [obj, id] of this._signalIds)
            obj.disconnect(id);
        this._signalIds = [];
        this._client = null;
        this._device = null;
    }
}
