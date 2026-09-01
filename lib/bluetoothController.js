import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseBluetoothState, sortBluetoothDevices} from './bluetoothData.js';

const BLUEZ_BUS_NAME = 'org.bluez';
const OBJECT_MANAGER_IFACE = 'org.freedesktop.DBus.ObjectManager';
const ADAPTER_IFACE = 'org.bluez.Adapter1';
const DEVICE_IFACE = 'org.bluez.Device1';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

export class BluetoothController {
    /**
     * @param {(state: object) => void} onChange
     * @param {(devices: object[]) => void} [onDevicesChange]
     */
    constructor(onChange, onDevicesChange) {
        this._onChange = onChange;
        this._onDevicesChange = onDevicesChange ?? (() => {});
        this._objectManager = null;
        this._adapterProxy = null;
        this._adapterPath = null;
        this._signalIds = [];
        this._isDestroyed = false;

        // DO_NOT_AUTO_START: without it, creating this proxy actively asks D-Bus to launch
        // bluez if it isn't already running, and on hardware where bluez never actually comes
        // up (no controller, driver issue) that's a real, confirmed 25-second
        // StartServiceByName timeout before this ever reports failure -- caught live via a
        // fresh headless shell start tonight, real stack trace into this exact file. The
        // callback below is still async either way (this was never blocking GNOME Shell's own
        // main loop, `new BluetoothController(...)` at every call site is fire-and-forget,
        // never awaited) but there's no reason to eat a 25s D-Bus activation timeout for a
        // menu tile that should just show "unavailable" quickly instead.
        Gio.DBusProxy.new(
            Gio.DBus.system, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
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
        const devices = [];

        for (const [path, interfaces] of Object.entries(objects)) {
            if (!adapterPath && interfaces[ADAPTER_IFACE])
                adapterPath = path;

            const device = interfaces[DEVICE_IFACE];
            if (!device)
                continue;

            const connected = device.Connected?.unpack() === true;
            const paired = device.Paired?.unpack() === true || device.Bonded?.unpack() === true;
            const name = device.Name?.unpack() ?? device.Alias?.unpack() ?? null;

            if (connected && !connectedDeviceName)
                connectedDeviceName = name;

            // Real devices only -- BlueZ's ObjectManager also returns pure discovery
            // artifacts with neither a name nor a pairing/connection state worth showing
            // in a picker (they disappear again a few seconds later on their own).
            if (name || paired || connected)
                devices.push({path, name, connected, paired});
        }

        if (adapterPath && adapterPath !== this._adapterPath)
            this._trackAdapter(adapterPath);

        const powered = this._adapterProxy
            ? (this._adapterProxy.get_cached_property('Powered')?.unpack() ?? false)
            : false;

        this._onChange(parseBluetoothState({powered, connectedDeviceName}));
        this._onDevicesChange(powered ? sortBluetoothDevices(devices) : []);
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

    // Public re-read of BlueZ's current state. Needed because a device's own Connected/Paired
    // properties changing (the result of the Connect()/Disconnect() calls below, or of a
    // device connecting on its own from the other side, e.g. AirPods coming back in range)
    // fires org.freedesktop.DBus.Properties.PropertiesChanged on that *device's* object path,
    // not InterfacesAdded/Removed on the ObjectManager this class actually listens to -- so
    // nothing here refreshes on its own when only a Connected flag flips. The caller (see
    // bluetoothIndicator.js) covers this with an explicit call right after Connect/Disconnect
    // finishes, plus a short poll while its menu is open, rather than this class opening and
    // tracking a live property-watch proxy per device just to catch the rarer external case.
    refresh() {
        this._refresh();
    }

    toggle() {
        if (!this._adapterPath)
            return;
        const powered = this._adapterProxy?.get_cached_property('Powered')?.unpack() ?? false;
        try {
            Gio.DBus.system.call_sync(
                BLUEZ_BUS_NAME, this._adapterPath, PROPERTIES_IFACE, 'Set',
                new GLib.Variant('(ssv)', [ADAPTER_IFACE, 'Powered', new GLib.Variant('b', !powered)]),
                null, Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to toggle Bluetooth power');
        }
    }

    // Discovery, connect and disconnect all involve real radio/negotiation time (seconds,
    // not milliseconds) -- these go over Gio.DBus.system.call() (async) rather than
    // call_sync() like the property reads/writes above, since a sync call here would freeze
    // the whole Shell UI thread for however long BlueZ takes to answer.
    startDiscovery() {
        if (!this._adapterPath)
            return;
        Gio.DBus.system.call(
            BLUEZ_BUS_NAME, this._adapterPath, ADAPTER_IFACE, 'StartDiscovery', null, null,
            Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (e) {
                    // Already discovering (another client, or a previous StartDiscovery still
                    // in flight) is the common, harmless case -- BlueZ just errors on the
                    // second call rather than being idempotent.
                }
            });
    }

    stopDiscovery() {
        if (!this._adapterPath)
            return;
        Gio.DBus.system.call(
            BLUEZ_BUS_NAME, this._adapterPath, ADAPTER_IFACE, 'StopDiscovery', null, null,
            Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (e) {
                    // Not discovering in the first place -- fine.
                }
            });
    }

    /**
     * @param {string} path
     * @param {(error: Error|null) => void} [callback]
     */
    connectDevice(path, callback) {
        Gio.DBus.system.call(
            BLUEZ_BUS_NAME, path, DEVICE_IFACE, 'Connect', null, null,
            Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try {
                    connection.call_finish(result);
                    callback?.(null);
                } catch (e) {
                    logError(e, `[macos-top-panel] control center: failed to connect Bluetooth device ${path}`);
                    callback?.(e);
                }
            });
    }

    /**
     * @param {string} path
     * @param {(error: Error|null) => void} [callback]
     */
    disconnectDevice(path, callback) {
        Gio.DBus.system.call(
            BLUEZ_BUS_NAME, path, DEVICE_IFACE, 'Disconnect', null, null,
            Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try {
                    connection.call_finish(result);
                    callback?.(null);
                } catch (e) {
                    logError(e, `[macos-top-panel] control center: failed to disconnect Bluetooth device ${path}`);
                    callback?.(e);
                }
            });
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
