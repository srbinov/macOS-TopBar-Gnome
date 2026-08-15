import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseBluetoothState} from './bluetoothData.js';

const BLUEZ_BUS_NAME = 'org.bluez';
const OBJECT_MANAGER_IFACE = 'org.freedesktop.DBus.ObjectManager';
const ADAPTER_IFACE = 'org.bluez.Adapter1';
const DEVICE_IFACE = 'org.bluez.Device1';

export class BluetoothController {
    constructor(onChange) {
        this._onChange = onChange;
        this._objectManager = null;
        this._adapterProxy = null;
        this._adapterPath = null;
        this._signalIds = [];
        this._isDestroyed = false;

        Gio.DBusProxy.new(
            Gio.DBus.system, Gio.DBusProxyFlags.NONE, null,
            BLUEZ_BUS_NAME, '/', OBJECT_MANAGER_IFACE, null,
            (source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    if (this._isDestroyed)
                        return;
                    this._objectManager = proxy;
                    this._signalIds.push(
                        [proxy, proxy.connect('g-signal', (_p, _sender, signal) => {
                            if (signal === 'InterfacesAdded' || signal === 'InterfacesRemoved')
                                this._refresh();
                        })]);
                    this._refresh();
                } catch (e) {
                    logError(e, '[macos-top-panel] control center: failed to connect to BlueZ');
                }
            });
    }

    _refresh() {
        if (!this._objectManager || this._isDestroyed)
            return;

        let objects;
        try {
            const result = this._objectManager.call_sync('GetManagedObjects', null, Gio.DBusCallFlags.NONE, -1, null);
            [objects] = result.deep_unpack();
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to read BlueZ objects');
            return;
        }

        let adapterPath = null;
        let connectedDeviceName = null;

        for (const [path, interfaces] of Object.entries(objects)) {
            if (!adapterPath && interfaces[ADAPTER_IFACE])
                adapterPath = path;

            const device = interfaces[DEVICE_IFACE];
            if (device && device.Connected?.unpack() === true)
                connectedDeviceName = device.Name?.unpack() ?? device.Alias?.unpack() ?? null;
        }

        if (adapterPath && adapterPath !== this._adapterPath)
            this._trackAdapter(adapterPath);

        const powered = this._adapterProxy
            ? (this._adapterProxy.get_cached_property('Powered')?.unpack() ?? false)
            : false;

        this._onChange(parseBluetoothState({powered, connectedDeviceName}));
    }

    _trackAdapter(path) {
        this._adapterPath = path;
        Gio.DBusProxy.new(
            Gio.DBus.system, Gio.DBusProxyFlags.NONE, null,
            BLUEZ_BUS_NAME, path, ADAPTER_IFACE, null,
            (source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    if (this._isDestroyed)
                        return;
                    this._adapterProxy = proxy;
                    this._signalIds.push(
                        [proxy, proxy.connect('g-properties-changed', () => this._refresh())]);
                    this._refresh();
                } catch (e) {
                    logError(e, '[macos-top-panel] control center: failed to connect to the BlueZ adapter');
                }
            });
    }

    toggle() {
        if (!this._adapterPath)
            return;
        const powered = this._adapterProxy?.get_cached_property('Powered')?.unpack() ?? false;
        try {
            Gio.DBus.system.call_sync(
                BLUEZ_BUS_NAME, this._adapterPath, 'org.freedesktop.DBus.Properties', 'Set',
                new GLib.Variant('(ssv)', [ADAPTER_IFACE, 'Powered', new GLib.Variant('b', !powered)]),
                null, Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to toggle Bluetooth power');
        }
    }

    destroy() {
        this._isDestroyed = true;
        for (const [obj, id] of this._signalIds)
            obj.disconnect(id);
        this._signalIds = [];
        this._objectManager = null;
        this._adapterProxy = null;
    }
}
