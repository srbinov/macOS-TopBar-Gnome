# Control Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the icon-swap-on-the-real-Quick-Settings-button Control Center with a fully custom, functional macOS-style popup (Wi-Fi pill, Bluetooth + Screen Mirroring circles, Focus pill, MPRIS media card, brightness slider).

**Architecture:** A new `ControlCenterIndicator` (`PanelMenu.Button`, same family as the existing `WifiIndicator`/`BatteryIndicator`/`SoundIndicator`) builds its popup content from raw `St` actors added directly into a non-reactive `PopupMenu.PopupBaseMenuItem` wrapper, rather than a list of `PopupMenuItem` rows. Six small controller classes (one per tile) own the D-Bus/GSettings/sysfs wiring and call back into the indicator with plain-data state objects; three of them delegate parsing/math to pure, unit-tested `*Data.js` modules.

**Tech Stack:** GJS (ESM), GObject introspection (`Gio`, `GLib`, `NM`, `St`, `Clutter`, `Soup` 3.0), GNOME Shell 50 `PanelMenu`/`PopupMenu`/`Slider` APIs, BlueZ D-Bus API, MPRIS2, systemd-logind D-Bus API, GSettings.

## Global Constraints

- Every new file in `lib/` uses 4-space indentation and semicolons, matching every existing file in `lib/` (`wifiIndicator.js`, `batteryData.js`, etc.) — do not use the 2-space style found in `src/`.
- Pure logic goes in `*Data.js` files with no `gi://` imports and a matching `tests/*.test.js`; D-Bus/GObject glue goes in `*Controller.js`/`*Indicator.js` files with no unit tests (matches the existing repo-wide pattern — none of `wifiIndicator.js`/`batteryIndicator.js`/`soundIndicator.js` have tests, only their `*Data.js` companions do).
- Tests run with `gjs -m tests/<file>.test.js` from the repo root (no test framework/package.json in this repo — confirmed by running the existing suite this way).
- No new GSettings schema/keys. Every toggle reads/writes the exact system-level source GNOME's own stock toggles use (see the spec's backend table) — do not invent new persisted state.
- New CSS lives under a `.macos-control-center-*` namespace in `stylesheet.css`, isolated from `.kiwi-*`/`.macos-clock*` rules.
- GObject classes in `lib/` are registered with plain `GObject.registerClass(class X extends Y {...})` — no explicit `GTypeName`, matching `BatteryIndicator`/`WifiIndicator`/`SoundIndicator` (not the `{GTypeName: '...'}` form used in `src/kiwimenu.js`).
- Every `Gio.DBusProxy`/`NM.Client`/D-Bus async setup must guard its callback with an `_isDestroyed` check before touching `this`, exactly as `wifiIndicator.js` and `batteryIndicator.js` already do — extensions can be disabled while an async call is in flight.
- This is a live GNOME Shell extension with no automated UI test harness. Each phase's final task ends with a manual verification checkpoint: the user reloads GNOME Shell (Alt+F2, `r`, Enter) and confirms the new tile(s) behave correctly on their real desktop. Do not mark a phase done without that confirmation.

---

## Task 1: Bluetooth pure-logic module

**Files:**
- Create: `lib/bluetoothData.js`
- Test: `tests/bluetoothData.test.js`

**Interfaces:**
- Produces: `parseBluetoothState(props: {powered: boolean, connectedDeviceName: string|null}) -> {powered: boolean, connectedDeviceName: string|null, statusLabel: string}`

- [ ] **Step 1: Write the failing test**

```js
// tests/bluetoothData.test.js
import {parseBluetoothState} from '../lib/bluetoothData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// powered off
{
    const result = parseBluetoothState({powered: false, connectedDeviceName: null});
    assertEqual(result.powered, false, 'off: powered false');
    assertEqual(result.connectedDeviceName, null, 'off: no device even if one was passed');
    assertEqual(result.statusLabel, 'Bluetooth Off', 'off: statusLabel');
}

// powered off, device name passed anyway (should still be null)
{
    const result = parseBluetoothState({powered: false, connectedDeviceName: 'AirPods'});
    assertEqual(result.connectedDeviceName, null, 'off: device name ignored while powered off');
}

// powered on, nothing connected
{
    const result = parseBluetoothState({powered: true, connectedDeviceName: null});
    assertEqual(result.powered, true, 'on/disconnected: powered true');
    assertEqual(result.statusLabel, 'Not Connected', 'on/disconnected: statusLabel');
}

// powered on, device connected
{
    const result = parseBluetoothState({powered: true, connectedDeviceName: 'AirPods'});
    assertEqual(result.connectedDeviceName, 'AirPods', 'connected: device name');
    assertEqual(result.statusLabel, 'AirPods', 'connected: statusLabel is the device name');
}

print('All bluetoothData tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/bluetoothData.test.js`
Expected: FAIL — `parseBluetoothState` is not defined / import error, since `lib/bluetoothData.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
// lib/bluetoothData.js
/** @param {{powered: boolean, connectedDeviceName: string|null}} props */
export function parseBluetoothState(props) {
    const powered = props.powered;
    const connectedDeviceName = powered ? (props.connectedDeviceName ?? null) : null;

    let statusLabel;
    if (!powered)
        statusLabel = 'Bluetooth Off';
    else if (connectedDeviceName)
        statusLabel = connectedDeviceName;
    else
        statusLabel = 'Not Connected';

    return {powered, connectedDeviceName, statusLabel};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/bluetoothData.test.js`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/bluetoothData.js tests/bluetoothData.test.js
git commit -m "Add pure Bluetooth state parsing for the Control Center redesign"
```

---

## Task 2: Wi-Fi tile controller

**Files:**
- Create: `lib/wifiTileController.js`

**Interfaces:**
- Consumes: `parseWifiState` from `lib/wifiData.js` (already exists — `{wirelessEnabled, ssid, strength} -> {enabled, connected, ssid, strength, statusLabel}`)
- Produces: `class WifiTileController { constructor(onChange: (state) => void); toggle(): void; destroy(): void }`. `onChange` fires with the same shape `parseWifiState` returns.

- [ ] **Step 1: Write the implementation**

This duplicates `lib/wifiIndicator.js`'s `NM.Client` wiring (a second, independent client connection) rather than sharing state with the panel Wi-Fi indicator — kept simple and decoupled on purpose, per the design's YAGNI call.

```js
// lib/wifiTileController.js
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/wifiTileController.js
git commit -m "Add Wi-Fi tile controller for the Control Center redesign"
```

---

## Task 3: Bluetooth controller

**Files:**
- Create: `lib/bluetoothController.js`

**Interfaces:**
- Consumes: `parseBluetoothState` from `lib/bluetoothData.js` (Task 1)
- Produces: `class BluetoothController { constructor(onChange: (state) => void); toggle(): void; destroy(): void }`. `onChange` fires with `{powered, connectedDeviceName, statusLabel}`.

**Verified live against this machine:** `org.bluez` at `/org/bluez/hci0` exposes `org.bluez.Adapter1` with a settable `Powered` property; `GetManagedObjects()` via `org.freedesktop.DBus.ObjectManager` at `/` returns each interface's properties as `a{sv}` where every value is still a `GLib.Variant` needing `.unpack()` — confirmed empirically (`deep_unpack()` on the outer container does **not** recursively unpack nested variant-typed leaves).

- [ ] **Step 1: Write the implementation**

```js
// lib/bluetoothController.js
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/bluetoothController.js
git commit -m "Add Bluetooth controller for the Control Center redesign"
```

---

## Task 4: Control Center popup shell — Wi-Fi pill + Bluetooth circle

**Files:**
- Create: `lib/controlCenterIndicator.js`
- Modify: `stylesheet.css` (append)

**Interfaces:**
- Consumes: `WifiTileController` (Task 2), `BluetoothController` (Task 3)
- Produces: `export const ControlCenterIndicator` (GObject class, `PanelMenu.Button` subclass), `_init(extensionPath: string)`. Later tasks extend this file's `_buildMenu()`, `_init()`, and `destroy` wiring by anchor (method name), not line number, since those line numbers don't exist yet at plan-writing time.

This establishes the "raw actors inside a non-reactive `PopupBaseMenuItem`" layout technique already proven elsewhere in this repo (`src/recentItemsSubmenu.js`'s `_createSectionHeader`, which does `new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false})` then `.add_child(...)`).

- [ ] **Step 1: Write the CSS foundation**

Append to `stylesheet.css`:

```css

/*###############################################*/
/*             Control Center Styles              */
/*###############################################*/
.macos-control-center-menu {
  width: 360px;
  padding: 14px;
}

.macos-control-center-row {
  spacing: 10px;
}

.macos-control-center-column {
  spacing: 10px;
}

.macos-control-center-pill {
  border-radius: 999px;
  padding: 10px 14px;
  background-color: rgba(255, 255, 255, 0.08);
}

.macos-control-center-pill:hover {
  background-color: rgba(255, 255, 255, 0.14);
}

.macos-control-center-pill.on {
  background-color: rgba(10, 132, 255, 0.35);
}

.macos-control-center-pill-icon-badge {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.9);
}

.macos-control-center-pill-icon-badge StIcon {
  icon-size: 16px;
  color: #222222;
}

.macos-control-center-pill-title {
  font-weight: bold;
  font-size: 1em;
}

.macos-control-center-pill-subtitle {
  font-size: 0.85em;
  color: rgba(255, 255, 255, 0.6);
}

.macos-control-center-circle-button {
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.08);
}

.macos-control-center-circle-button StIcon {
  icon-size: 22px;
}

.macos-control-center-circle-button:hover {
  background-color: rgba(255, 255, 255, 0.14);
}

.macos-control-center-circle-button.on {
  background-color: rgb(10, 132, 255);
  color: white;
}
```

- [ ] **Step 2: Write `lib/controlCenterIndicator.js` (Phase 1 subset)**

```js
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

        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
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
});
```

Note: toggle state uses a plain `on` style **class** (`add_style_class_name`/`remove_style_class_name`), not St's built-in `:active` pseudo-class — `:active` already means "currently being pressed" for `St.Button` and reusing it for "toggled on" would fight the button's native press-feedback styling.

- [ ] **Step 3: Commit**

```bash
git add lib/controlCenterIndicator.js stylesheet.css
git commit -m "Add Control Center popup shell with Wi-Fi pill and Bluetooth circle"
```

---

## Task 5: Wire the new indicator into the extension, retire the old one

**Files:**
- Modify: `extension.js`
- Delete: `lib/controlCenterIcon.js`

**Interfaces:**
- Consumes: `ControlCenterIndicator` (Task 4)

- [ ] **Step 1: Update the import**

In `extension.js`, change:

```js
import {ControlCenterIconController} from './lib/controlCenterIcon.js';
```

to:

```js
import {ControlCenterIndicator} from './lib/controlCenterIndicator.js';
```

- [ ] **Step 2: Replace the relocation + icon-swap block in `enable()`**

Replace this block (currently right after the sound indicator is added, before the clock widget):

```js
            // Control Center: reuse the real stock Quick Settings button, just relocated.
            const quickSettings = Main.panel.statusArea.quickSettings;
            quickSettings.container.show();
            Main.panel._rightBox.add_child(quickSettings.container);

            // Replace the stock wifi/battery/etc. icons on its face with a
            // single macOS-style Control Center icon — our own indicators
            // already show battery/wifi/sound.
            this._controlCenterIcon = new ControlCenterIconController(this.path);
```

with:

```js
            this._controlCenter = new ControlCenterIndicator(this.path);
            Main.panel.menuManager.addMenu(this._controlCenter.menu);
            Main.panel._rightBox.add_child(this._controlCenter.container);
```

This keeps the same position in `_rightBox` (after sound, before the clock) and matches the exact pattern already used for `_batteryIndicator`/`_wifiIndicator`/`_soundIndicator` just above it. The real `Main.panel.statusArea.quickSettings` is no longer shown or relocated — like the stock battery/Wi-Fi/sound indicators, it stays detached (removed by the earlier `clearBox(Main.panel._rightBox)` call) and is restored to its original spot by `restoreBox()` in `disable()`, unchanged.

- [ ] **Step 3: Replace the teardown block in `disable()`**

Replace:

```js
        this._controlCenterIcon?.destroy();
        this._controlCenterIcon = null;

        // Do NOT destroy quickSettings.container — it's the real stock object,
        // restoreBox() below puts it back where it came from.
```

with:

```js
        if (this._controlCenter?.menu)
            Main.panel.menuManager.removeMenu(this._controlCenter.menu);
        this._controlCenter?.destroy();
        this._controlCenter = null;
```

(matches the `_soundIndicator`/`_wifiIndicator`/`_batteryIndicator` teardown blocks immediately below it — no special-case comment needed anymore since `quickSettings.container` is never touched now).

- [ ] **Step 4: Delete the superseded file**

```bash
git rm lib/controlCenterIcon.js
```

- [ ] **Step 5: Phase 1 checkpoint — hand back to the user**

Ask the user to reload GNOME Shell (Alt+F2, `r`, Enter on X11; log out/in on Wayland) and confirm:
- The Control Center icon still appears in the same spot in the top-right.
- Clicking it opens the new pill/circle popup (not the old stock Quick Settings menu).
- The Wi-Fi pill shows the current network name and toggles Wi-Fi on/off when clicked.
- The Bluetooth circle reflects adapter power state and toggles it when clicked; hovering it shows the connected device name (if any) as a tooltip.

If anything looks wrong, check for stack traces with:
`journalctl --user -b 0 -n 300 | grep -iE 'macos-top-panel|controlCenter'`

- [ ] **Step 6: Commit**

```bash
git add extension.js
git commit -m "Wire the new Control Center indicator into the extension"
```

---

## Task 6: Screen Mirroring controller + circle

**Files:**
- Create: `lib/screenMirroringController.js`
- Modify: `lib/controlCenterIndicator.js`

**Interfaces:**
- Produces: `class ScreenMirroringController { constructor(onChange: (state: {enabled: boolean}) => void); toggle(): void; destroy(): void }`

**Verified live:** `org.gnome.desktop.remote-desktop.rdp` schema exists with an `enable` boolean key — the same key GNOME's stock "Screen Sharing" Quick Settings toggle flips.

- [ ] **Step 1: Write the controller**

```js
// lib/screenMirroringController.js
import Gio from 'gi://Gio';

const SCHEMA_ID = 'org.gnome.desktop.remote-desktop.rdp';
const KEY = 'enable';

export class ScreenMirroringController {
    constructor(onChange) {
        this._onChange = onChange;
        this._settings = new Gio.Settings({schema_id: SCHEMA_ID});
        this._signalId = this._settings.connect(`changed::${KEY}`, () => this._update());
        this._update();
    }

    _update() {
        this._onChange({enabled: this._settings.get_boolean(KEY)});
    }

    toggle() {
        this._settings.set_boolean(KEY, !this._settings.get_boolean(KEY));
    }

    destroy() {
        if (this._settings && this._signalId)
            this._settings.disconnect(this._signalId);
        this._signalId = 0;
        this._settings = null;
    }
}
```

- [ ] **Step 2: Wire it into `lib/controlCenterIndicator.js`**

Add the import, next to the existing controller imports:

```js
import {ScreenMirroringController} from './screenMirroringController.js';
```

In `_init`, right after `this._bluetooth = new BluetoothController(...)`, add:

```js
        this._screenMirroring = new ScreenMirroringController(state => this._updateScreenMirroring(state));
```

In the `connect('destroy', ...)` block, add a line so it reads:

```js
        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenMirroring.destroy();
        });
```

In `_buildMenu()`, right after the line that adds `this._bluetoothCircle.button` to `this._circleRow`, add:

```js
        this._mirrorCircle = this._createCircleButton('screen-shared-symbolic', () => this._screenMirroring.toggle());
        this._circleRow.add_child(this._mirrorCircle.button);
```

Add a new method, next to `_updateBluetooth`:

```js
    _updateScreenMirroring(state) {
        if (state.enabled)
            this._mirrorCircle.button.add_style_class_name('on');
        else
            this._mirrorCircle.button.remove_style_class_name('on');
    }
```

- [ ] **Step 3: Commit**

```bash
git add lib/screenMirroringController.js lib/controlCenterIndicator.js
git commit -m "Add Screen Mirroring circle to the Control Center"
```

---

## Task 7: Focus controller + pill (Phase 2 checkpoint)

**Files:**
- Create: `lib/focusController.js`
- Modify: `lib/controlCenterIndicator.js`
- Modify: `stylesheet.css` (append)

**Interfaces:**
- Produces: `class FocusController { constructor(onChange: (state: {enabled: boolean}) => void); toggle(): void; destroy(): void }`

**Verified live:** `org.gnome.desktop.notifications` schema has a `show-banners` boolean key — the same key GNOME's stock "Do Not Disturb" toggle flips (Focus on ⇒ banners suppressed).

- [ ] **Step 1: Write the controller**

```js
// lib/focusController.js
import Gio from 'gi://Gio';

const SCHEMA_ID = 'org.gnome.desktop.notifications';
const KEY = 'show-banners';

export class FocusController {
    constructor(onChange) {
        this._onChange = onChange;
        this._settings = new Gio.Settings({schema_id: SCHEMA_ID});
        this._signalId = this._settings.connect(`changed::${KEY}`, () => this._update());
        this._update();
    }

    _update() {
        // Focus is "on" exactly when notification banners are suppressed.
        this._onChange({enabled: !this._settings.get_boolean(KEY)});
    }

    toggle() {
        this._settings.set_boolean(KEY, !this._settings.get_boolean(KEY));
    }

    destroy() {
        if (this._settings && this._signalId)
            this._settings.disconnect(this._signalId);
        this._signalId = 0;
        this._settings = null;
    }
}
```

- [ ] **Step 2: Append the Focus pill's color override to `stylesheet.css`**

```css

.macos-control-center-focus-pill.on {
  background-color: rgba(94, 92, 230, 0.5);
}
```

(placed after the generic `.macos-control-center-pill.on` rule from Task 4, so it wins the cascade on the tied two-class specificity by source order.)

- [ ] **Step 3: Wire it into `lib/controlCenterIndicator.js`**

Add the import:

```js
import {FocusController} from './focusController.js';
```

In `_init`, after the `_screenMirroring` construction line, add:

```js
        this._focus = new FocusController(state => this._updateFocus(state));
```

Extend the destroy block:

```js
        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenMirroring.destroy();
            this._focus.destroy();
        });
```

In `_buildMenu()`, right after `this.menu.addMenuItem(root);` is called... actually insert this **before** that line (Focus needs to be added to `this._container`, which happens before `root` is committed to the menu). Insert right after the block that builds `this._circleRow`/`this._mirrorCircle` (i.e., as the next thing added to `this._container`, a sibling of `this._topRow`, spanning full width below it):

```js
        this._focusPill = this._createPill('weather-clear-night-symbolic', 'Focus', '', () => this._focus.toggle());
        this._focusPill.actor.add_style_class_name('macos-control-center-focus-pill');
        this._container.add_child(this._focusPill.actor);
```

Add the update method, next to `_updateScreenMirroring`:

```js
    _updateFocus(state) {
        if (state.enabled)
            this._focusPill.actor.add_style_class_name('on');
        else
            this._focusPill.actor.remove_style_class_name('on');
    }
```

- [ ] **Step 4: Phase 2 checkpoint — hand back to the user**

Ask the user to reload GNOME Shell and confirm:
- A new circle next to Bluetooth toggles Screen Sharing (check `gsettings get org.gnome.desktop.remote-desktop.rdp enable` before/after to confirm it flips).
- A full-width Focus pill below toggles Do Not Disturb (check `gsettings get org.gnome.desktop.notifications show-banners` before/after — should invert).

- [ ] **Step 5: Commit**

```bash
git add lib/focusController.js lib/controlCenterIndicator.js stylesheet.css
git commit -m "Add Focus pill to the Control Center"
```

---

## Task 8: Brightness pure-logic module

**Files:**
- Create: `lib/brightnessData.js`
- Test: `tests/brightnessData.test.js`

**Interfaces:**
- Produces:
  - `rawToPercent(props: {raw: number, max: number}) -> number` (0-100, rounded, clamped)
  - `percentToRaw(props: {percent: number, max: number}) -> number` (rounded, input percent clamped to 0-100 first)

- [ ] **Step 1: Write the failing test**

```js
// tests/brightnessData.test.js
import {rawToPercent, percentToRaw} from '../lib/brightnessData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

assertEqual(rawToPercent({raw: 0, max: 96000}), 0, 'rawToPercent: zero');
assertEqual(rawToPercent({raw: 96000, max: 96000}), 100, 'rawToPercent: full');
assertEqual(rawToPercent({raw: 48000, max: 96000}), 50, 'rawToPercent: half');
assertEqual(rawToPercent({raw: 52609, max: 96000}), 55, 'rawToPercent: rounds to nearest percent');
assertEqual(rawToPercent({raw: 0, max: 0}), 0, 'rawToPercent: zero max does not divide by zero');
assertEqual(rawToPercent({raw: 999999, max: 96000}), 100, 'rawToPercent: clamps above 100');

assertEqual(percentToRaw({percent: 0, max: 96000}), 0, 'percentToRaw: zero');
assertEqual(percentToRaw({percent: 100, max: 96000}), 96000, 'percentToRaw: full');
assertEqual(percentToRaw({percent: 50, max: 96000}), 48000, 'percentToRaw: half');
assertEqual(percentToRaw({percent: 150, max: 96000}), 96000, 'percentToRaw: clamps above 100');
assertEqual(percentToRaw({percent: -10, max: 96000}), 0, 'percentToRaw: clamps below 0');

print('All brightnessData tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/brightnessData.test.js`
Expected: FAIL — import error, `lib/brightnessData.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
// lib/brightnessData.js
/** @param {{raw: number, max: number}} props */
export function rawToPercent(props) {
    if (props.max <= 0)
        return 0;
    return Math.max(0, Math.min(100, Math.round((props.raw / props.max) * 100)));
}

/** @param {{percent: number, max: number}} props */
export function percentToRaw(props) {
    const clampedPercent = Math.max(0, Math.min(100, props.percent));
    return Math.round((clampedPercent / 100) * props.max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/brightnessData.test.js`
Expected: PASS (11 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/brightnessData.js tests/brightnessData.test.js
git commit -m "Add pure brightness percentage math for the Control Center redesign"
```

---

## Task 9: Brightness controller + Display slider (Phase 3 checkpoint)

**Files:**
- Create: `lib/brightnessController.js`
- Modify: `lib/controlCenterIndicator.js`
- Modify: `stylesheet.css` (append)

**Interfaces:**
- Consumes: `rawToPercent`, `percentToRaw` from `lib/brightnessData.js` (Task 8)
- Produces: `class BrightnessController { constructor(onChange: (state: {percent: number}) => void); setPercent(percent: number): void; destroy(): void }`

**Verified live on this machine:**
- Backlight device found at `/sys/class/backlight/intel_backlight/` (world-readable `brightness`/`max_brightness`).
- There is no `/org/freedesktop/login1/session/self` path — the session object path must be resolved once via `org.freedesktop.login1.Manager.GetSessionByPID(0)` (PID `0` auto-resolves to the caller), the same mechanism GNOME Shell's own `js/misc/loginManager.js` uses internally.
- `org.freedesktop.login1.Session.SetBrightness(subsystem: s, name: s, brightness: u)` is callable by the logged-in user without elevated privileges (confirmed via `busctl introspect`).
- The GNOME Shell reusable `Slider` actor lives at `resource:///org/gnome/shell/ui/slider.js` and exports `Slider` — this is a long-standing, stable GNOME Shell UI class (used internally for the stock volume/brightness sliders). This can only be confirmed by GJS resolving the `resource:///` URI inside the actual running gnome-shell process — there's no way to statically check it outside that process. **If this import throws** when the user reloads the Shell, check the exact error text with `journalctl --user -b 0 | grep -i slider.js` — it will show gjs's raw resource lookup failure, which tells you whether the path or the export name needs adjusting for this Shell version.

- [ ] **Step 1: Write the controller**

```js
// lib/brightnessController.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {rawToPercent, percentToRaw} from './brightnessData.js';

const BACKLIGHT_DIR = '/sys/class/backlight';

export class BrightnessController {
    constructor(onChange) {
        this._onChange = onChange;
        this._device = null;
        this._max = 0;
        this._monitor = null;
        this._monitorSignalId = 0;
        this._sessionPath = null;
        this._isDestroyed = false;

        this._findDevice();
        this._resolveSession();
    }

    _findDevice() {
        try {
            const dir = Gio.File.new_for_path(BACKLIGHT_DIR);
            const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            const info = children.next_file(null);
            children.close(null);
            if (!info)
                return;

            this._device = info.get_name();

            const maxFile = Gio.File.new_for_path(GLib.build_filenamev([BACKLIGHT_DIR, this._device, 'max_brightness']));
            const [, maxContents] = maxFile.load_contents(null);
            this._max = parseInt(new TextDecoder().decode(maxContents).trim(), 10) || 0;

            const brightnessFile = Gio.File.new_for_path(GLib.build_filenamev([BACKLIGHT_DIR, this._device, 'brightness']));
            this._monitor = brightnessFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorSignalId = this._monitor.connect('changed', () => this._readBrightness());
            this._readBrightness();
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to find a backlight device');
        }
    }

    _readBrightness() {
        if (!this._device || this._isDestroyed)
            return;
        try {
            const brightnessFile = Gio.File.new_for_path(GLib.build_filenamev([BACKLIGHT_DIR, this._device, 'brightness']));
            const [, contents] = brightnessFile.load_contents(null);
            const raw = parseInt(new TextDecoder().decode(contents).trim(), 10) || 0;
            this._onChange({percent: rawToPercent({raw, max: this._max})});
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to read screen brightness');
        }
    }

    _resolveSession() {
        Gio.DBus.system.call(
            'org.freedesktop.login1', '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager', 'GetSessionByPID',
            new GLib.Variant('(u)', [0]), new GLib.VariantType('(o)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (source, result) => {
                try {
                    const reply = source.call_finish(result);
                    if (this._isDestroyed)
                        return;
                    [this._sessionPath] = reply.deep_unpack();
                } catch (e) {
                    logError(e, '[macos-top-panel] control center: failed to resolve the current login session');
                }
            });
    }

    setPercent(percent) {
        if (!this._device || !this._sessionPath || this._max <= 0)
            return;
        const raw = percentToRaw({percent, max: this._max});
        try {
            Gio.DBus.system.call_sync(
                'org.freedesktop.login1', this._sessionPath, 'org.freedesktop.login1.Session', 'SetBrightness',
                new GLib.Variant('(ssu)', ['backlight', this._device, raw]),
                null, Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to set screen brightness');
        }
    }

    destroy() {
        this._isDestroyed = true;
        if (this._monitor && this._monitorSignalId)
            this._monitor.disconnect(this._monitorSignalId);
        this._monitor = null;
    }
}
```

- [ ] **Step 2: Append the Display card CSS to `stylesheet.css`**

```css

.macos-control-center-display-card {
  border-radius: 20px;
  padding: 12px 16px;
  spacing: 8px;
  background-color: rgba(10, 132, 255, 0.25);
}
```

- [ ] **Step 3: Wire it into `lib/controlCenterIndicator.js`**

Add the imports:

```js
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {BrightnessController} from './brightnessController.js';
```

In `_init`, after the `_focus` construction line, add:

```js
        this._suppressSliderNotify = false;
        this._brightness = new BrightnessController(state => this._updateBrightness(state));
```

Extend the destroy block:

```js
        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenMirroring.destroy();
            this._focus.destroy();
            this._brightness.destroy();
        });
```

In `_buildMenu()`, right after the Focus pill is added to `this._container` (from Task 7), add:

```js
        this._displayCard = this._createDisplayCard();
        this._container.add_child(this._displayCard.actor);
```

Add two new methods, next to the other `_create*` helpers:

```js
    _createDisplayCard() {
        const actor = new St.BoxLayout({vertical: true, style_class: 'macos-control-center-display-card', x_expand: true});

        const titleLabel = new St.Label({text: 'Display', style_class: 'macos-control-center-pill-title'});
        actor.add_child(titleLabel);

        const sliderRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        actor.add_child(sliderRow);

        const lowIcon = new St.Icon({icon_name: 'display-brightness-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER});
        sliderRow.add_child(lowIcon);

        const slider = new Slider(0);
        slider.x_expand = true;
        slider.connect('notify::value', () => {
            if (this._suppressSliderNotify)
                return;
            this._brightness.setPercent(Math.round(slider.value * 100));
        });
        sliderRow.add_child(slider);

        const highIcon = new St.Icon({icon_name: 'display-brightness-symbolic', icon_size: 20, y_align: Clutter.ActorAlign.CENTER});
        sliderRow.add_child(highIcon);

        return {actor, slider};
    }

    _updateBrightness(state) {
        this._suppressSliderNotify = true;
        this._displayCard.slider.value = state.percent / 100;
        this._suppressSliderNotify = false;
    }
```

- [ ] **Step 4: Phase 3 checkpoint — hand back to the user**

Ask the user to reload GNOME Shell and confirm:
- The Display slider's initial position matches the current screen brightness.
- Dragging the slider changes real screen brightness live.
- Changing brightness with hardware keys (if available) moves the slider to match, without the slider drag handler fighting it (no jitter/snap-back).

If the `Slider` import fails, check `journalctl --user -b 0 | grep -i slider.js` per the note above and report the exact error back before proceeding.

- [ ] **Step 5: Commit**

```bash
git add lib/brightnessController.js lib/controlCenterIndicator.js stylesheet.css
git commit -m "Add Display brightness slider to the Control Center"
```

---

## Task 10: MPRIS pure-logic module

**Files:**
- Create: `lib/mprisData.js`
- Test: `tests/mprisData.test.js`

**Interfaces:**
- Produces:
  - `extractMetadata(metadata: {'xesam:title'?: string, 'xesam:artist'?: string[], 'mpris:artUrl'?: string}) -> {title: string|null, artist: string|null, artUrl: string|null}`
  - `parseMediaState(props: {title: string|null, artist: string|null, artUrl: string|null, playbackStatus: string|null, canGoNext: boolean, canGoPrevious: boolean, canPlay: boolean, canPause: boolean}) -> {isActive: boolean, isPlaying: boolean, title: string, artist: string, artUrl: string|null, canGoNext: boolean, canGoPrevious: boolean, canTogglePlayback: boolean}`

Both functions take already-`.unpack()`-ed plain JS values — no `GLib.Variant` handling here, that's the controller's job (Task 11).

- [ ] **Step 1: Write the failing test**

```js
// tests/mprisData.test.js
import {extractMetadata, parseMediaState} from '../lib/mprisData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// extractMetadata
{
    const result = extractMetadata({
        'xesam:title': 'Besties',
        'xesam:artist': ['Black Country, New Road'],
        'mpris:artUrl': 'https://example.com/art.jpg',
    });
    assertEqual(result, {title: 'Besties', artist: 'Black Country, New Road', artUrl: 'https://example.com/art.jpg'},
        'extractMetadata: full metadata');
}

{
    const result = extractMetadata({});
    assertEqual(result, {title: null, artist: null, artUrl: null}, 'extractMetadata: empty metadata');
}

{
    const result = extractMetadata({'xesam:artist': []});
    assertEqual(result.artist, null, 'extractMetadata: empty artist array is null, not undefined');
}

// parseMediaState: idle
{
    const result = parseMediaState({
        title: null, artist: null, artUrl: null, playbackStatus: null,
        canGoNext: false, canGoPrevious: false, canPlay: false, canPause: false,
    });
    assertEqual(result.isActive, false, 'idle: not active');
    assertEqual(result.isPlaying, false, 'idle: not playing');
    assertEqual(result.title, '', 'idle: title defaults to empty string');
}

// parseMediaState: playing, can pause but not resume-from-pause distinction
{
    const result = parseMediaState({
        title: 'Besties', artist: 'Black Country, New Road', artUrl: null, playbackStatus: 'Playing',
        canGoNext: true, canGoPrevious: false, canPlay: false, canPause: true,
    });
    assertEqual(result.isActive, true, 'playing: active');
    assertEqual(result.isPlaying, true, 'playing: isPlaying true');
    assertEqual(result.canTogglePlayback, true, 'playing: can pause, so playback is togglable');
    assertEqual(result.canGoNext, true, 'playing: canGoNext passed through');
    assertEqual(result.canGoPrevious, false, 'playing: canGoPrevious passed through');
}

// parseMediaState: paused, cannot resume
{
    const result = parseMediaState({
        title: 'Besties', artist: 'Black Country, New Road', artUrl: null, playbackStatus: 'Paused',
        canGoNext: true, canGoPrevious: true, canPlay: false, canPause: true,
    });
    assertEqual(result.isActive, true, 'paused: still active');
    assertEqual(result.isPlaying, false, 'paused: isPlaying false');
    assertEqual(result.canTogglePlayback, false, 'paused: canPlay is false, so playback is not togglable');
}

// parseMediaState: stopped is not active
{
    const result = parseMediaState({
        title: 'Besties', artist: null, artUrl: null, playbackStatus: 'Stopped',
        canGoNext: false, canGoPrevious: false, canPlay: true, canPause: false,
    });
    assertEqual(result.isActive, false, 'stopped: not active');
}

print('All mprisData tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/mprisData.test.js`
Expected: FAIL — import error, `lib/mprisData.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
// lib/mprisData.js
/** @param {{'xesam:title'?: string, 'xesam:artist'?: string[], 'mpris:artUrl'?: string}} metadata */
export function extractMetadata(metadata) {
    const artistList = metadata['xesam:artist'];
    const artist = Array.isArray(artistList) && artistList.length > 0 ? artistList[0] : null;

    return {
        title: metadata['xesam:title'] ?? null,
        artist,
        artUrl: metadata['mpris:artUrl'] ?? null,
    };
}

/**
 * @param {{title: string|null, artist: string|null, artUrl: string|null, playbackStatus: string|null,
 *   canGoNext: boolean, canGoPrevious: boolean, canPlay: boolean, canPause: boolean}} props
 */
export function parseMediaState(props) {
    const isPlaying = props.playbackStatus === 'Playing';
    const isActive = isPlaying || props.playbackStatus === 'Paused';

    return {
        isActive,
        isPlaying,
        title: props.title ?? '',
        artist: props.artist ?? '',
        artUrl: props.artUrl ?? null,
        canGoNext: Boolean(props.canGoNext),
        canGoPrevious: Boolean(props.canGoPrevious),
        canTogglePlayback: isPlaying ? Boolean(props.canPause) : Boolean(props.canPlay),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/mprisData.test.js`
Expected: PASS (9 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/mprisData.js tests/mprisData.test.js
git commit -m "Add pure MPRIS metadata/state parsing for the Control Center redesign"
```

---

## Task 11: Media player controller + card (Phase 4 checkpoint)

**Files:**
- Create: `lib/mediaPlayerController.js`
- Modify: `lib/controlCenterIndicator.js`
- Modify: `stylesheet.css` (append)

**Interfaces:**
- Consumes: `extractMetadata`, `parseMediaState` from `lib/mprisData.js` (Task 10)
- Produces: `class MediaPlayerController { constructor(onChange: (state) => void); previous(): void; playPause(): void; next(): void; destroy(): void }`. `onChange` fires with everything `parseMediaState` returns, plus `artIcon: Gio.Icon|null`.

**Verified live:**
- `import Soup from 'gi://Soup?version=3.0';` resolves and `new Soup.Session()` / `Soup.Message.new('GET', url)` / `session.send_and_read_async(...)` / `source.send_and_read_finish(result)` / `message.get_status()` / `Soup.Status.OK` (=200) all work — confirmed with a real HTTP round-trip.
- `Gio.BytesIcon.new(bytes)` produces a valid `Gio.Icon` from raw fetched bytes, usable directly as `St.Icon`'s `gicon`.
- `Gio.icon_new_for_string('file://...')` produces a `Gio.FileIcon` that reads local files directly — used for `file://` art URIs, no network fetch needed. (`Gio.icon_new_for_string` does *not* error on `http(s)://` URIs either — it silently wraps them in a `Gio.FileIcon` too — but relying on that would require an optional `gvfsd-http` backend to actually be installed, so `http(s)://` art is fetched explicitly via Soup instead, for reliability.)
- Multi-player selection: per the design decision, when more than one MPRIS player is `Playing`/`Paused` at once, the one that **most recently changed state** wins (tracked via a per-player timestamp updated on every `g-properties-changed` signal).

- [ ] **Step 1: Write the controller**

```js
// lib/mediaPlayerController.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {extractMetadata, parseMediaState} from './mprisData.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

export class MediaPlayerController {
    constructor(onChange) {
        this._onChange = onChange;
        this._players = new Map(); // busName -> {proxy, propsChangedId, lastActive}
        this._artCache = new Map(); // artUrl -> Gio.Icon
        this._soupSession = new Soup.Session();
        this._selectedBusName = null;
        this._isDestroyed = false;

        this._discoverExistingPlayers();
        this._watchForNewPlayers();
        this._emitIdle();
    }

    _discoverExistingPlayers() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null,
            (source, result) => {
                try {
                    const reply = source.call_finish(result);
                    if (this._isDestroyed)
                        return;
                    const [names] = reply.deep_unpack();
                    names.filter(name => name.startsWith(MPRIS_PREFIX)).forEach(name => this._trackPlayer(name));
                } catch (e) {
                    logError(e, '[macos-top-panel] control center: failed to list MPRIS players');
                }
            });
    }

    _watchForNewPlayers() {
        this._nameOwnerChangedId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            null, Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner)
                    this._trackPlayer(name);
                else
                    this._untrackPlayer(name);
            });
    }

    _trackPlayer(busName) {
        if (this._players.has(busName) || this._isDestroyed)
            return;

        this._players.set(busName, {proxy: null, propsChangedId: 0, lastActive: 0});

        Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
            busName, '/org/mpris/MediaPlayer2', PLAYER_IFACE, null,
            (source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    const entry = this._players.get(busName);
                    if (this._isDestroyed || !entry)
                        return;
                    entry.proxy = proxy;
                    entry.propsChangedId = proxy.connect('g-properties-changed', () => this._onPlayerChanged(busName));
                    this._onPlayerChanged(busName);
                } catch (e) {
                    logError(e, `[macos-top-panel] control center: failed to connect to MPRIS player ${busName}`);
                }
            });
    }

    _untrackPlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;
        if (entry.proxy && entry.propsChangedId)
            entry.proxy.disconnect(entry.propsChangedId);
        this._players.delete(busName);
        this._recompute();
    }

    _onPlayerChanged(busName) {
        const entry = this._players.get(busName);
        if (!entry || !entry.proxy)
            return;
        entry.lastActive = GLib.get_monotonic_time();
        this._recompute();
    }

    _recompute() {
        let selectedName = null;
        let selectedEntry = null;

        for (const [name, entry] of this._players.entries()) {
            if (!entry.proxy)
                continue;
            const status = entry.proxy.get_cached_property('PlaybackStatus')?.unpack();
            if (status !== 'Playing' && status !== 'Paused')
                continue;
            if (!selectedEntry || entry.lastActive > selectedEntry.lastActive) {
                selectedEntry = entry;
                selectedName = name;
            }
        }

        this._selectedBusName = selectedName;

        if (!selectedEntry) {
            this._emitIdle();
            return;
        }

        const proxy = selectedEntry.proxy;
        const metadataVariant = proxy.get_cached_property('Metadata');
        const rawMetadata = metadataVariant ? metadataVariant.deep_unpack() : {};
        const unpackedMetadata = {};
        for (const [key, value] of Object.entries(rawMetadata))
            unpackedMetadata[key] = value.unpack();

        const {title, artist, artUrl} = extractMetadata(unpackedMetadata);

        const state = parseMediaState({
            title, artist, artUrl,
            playbackStatus: proxy.get_cached_property('PlaybackStatus')?.unpack() ?? null,
            canGoNext: proxy.get_cached_property('CanGoNext')?.unpack() ?? false,
            canGoPrevious: proxy.get_cached_property('CanGoPrevious')?.unpack() ?? false,
            canPlay: proxy.get_cached_property('CanPlay')?.unpack() ?? false,
            canPause: proxy.get_cached_property('CanPause')?.unpack() ?? false,
        });

        this._onChange({...state, artIcon: artUrl ? (this._artCache.get(artUrl) ?? null) : null});

        if (artUrl && !this._artCache.has(artUrl))
            this._loadArt(artUrl, state);
    }

    _emitIdle() {
        const state = parseMediaState({
            title: null, artist: null, artUrl: null, playbackStatus: null,
            canGoNext: false, canGoPrevious: false, canPlay: false, canPause: false,
        });
        this._onChange({...state, artIcon: null});
    }

    _loadArt(url, stateSnapshot) {
        if (url.startsWith('file://')) {
            const icon = Gio.icon_new_for_string(url);
            this._artCache.set(url, icon);
            if (this._selectedBusName)
                this._onChange({...stateSnapshot, artIcon: icon});
            return;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://'))
            return;

        const message = Soup.Message.new('GET', url);
        this._soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                const bytes = source.send_and_read_finish(result);
                if (this._isDestroyed || message.get_status() !== Soup.Status.OK)
                    return;
                const icon = Gio.BytesIcon.new(bytes);
                this._artCache.set(url, icon);
                this._onChange({...stateSnapshot, artIcon: icon});
            } catch (e) {
                logError(e, `[macos-top-panel] control center: failed to fetch media art from ${url}`);
            }
        });
    }

    previous() {
        this._callPlayerMethod('Previous');
    }

    next() {
        this._callPlayerMethod('Next');
    }

    playPause() {
        this._callPlayerMethod('PlayPause');
    }

    _callPlayerMethod(method) {
        const entry = this._selectedBusName ? this._players.get(this._selectedBusName) : null;
        if (!entry?.proxy)
            return;
        entry.proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
            try {
                source.call_finish(result);
            } catch (e) {
                logError(e, `[macos-top-panel] control center: MPRIS ${method} failed`);
            }
        });
    }

    destroy() {
        this._isDestroyed = true;
        if (this._nameOwnerChangedId)
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerChangedId);
        this._soupSession.abort();
        for (const entry of this._players.values()) {
            if (entry.proxy && entry.propsChangedId)
                entry.proxy.disconnect(entry.propsChangedId);
        }
        this._players.clear();
    }
}
```

- [ ] **Step 2: Append the media card CSS to `stylesheet.css`**

```css

.macos-control-center-media-card {
  border-radius: 18px;
  padding: 12px;
  spacing: 6px;
  background-color: rgba(255, 255, 255, 0.08);
}

.macos-control-center-media-art {
  width: 72px;
  height: 72px;
  border-radius: 14px;
  background-color: rgba(255, 255, 255, 0.12);
}

.macos-control-center-media-title {
  font-weight: bold;
  font-size: 0.95em;
}

.macos-control-center-media-artist {
  font-size: 0.8em;
  color: rgba(255, 255, 255, 0.6);
}

.macos-control-center-media-transport {
  spacing: 10px;
}

.macos-control-center-transport-button {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background-color: transparent;
}

.macos-control-center-transport-button:hover {
  background-color: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 3: Wire it into `lib/controlCenterIndicator.js`**

Add the imports:

```js
import Pango from 'gi://Pango';

import {MediaPlayerController} from './mediaPlayerController.js';
```

In `_init`, after the `_brightness` construction line, add:

```js
        this._media = new MediaPlayerController(state => this._updateMedia(state));
```

Extend the destroy block:

```js
        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenMirroring.destroy();
            this._focus.destroy();
            this._brightness.destroy();
            this._media.destroy();
        });
```

In `_buildMenu()`, right after the block that builds `this._leftColumn` and adds it to `this._topRow` (from Task 4) — i.e. immediately before the Wi-Fi pill is created, doesn't matter which side, just as long as it's added as the **second** child of `this._topRow` — add, right after `this._topRow.add_child(this._leftColumn);`:

```js
        this._mediaCard = this._createMediaCard();
        this._topRow.add_child(this._mediaCard.actor);
```

Add three new methods, next to the other `_create*` helpers:

```js
    _createMediaCard() {
        const actor = new St.BoxLayout({
            vertical: true,
            style_class: 'macos-control-center-media-card',
            x_expand: true,
            y_expand: true,
        });

        const artBin = new St.Bin({style_class: 'macos-control-center-media-art'});
        artBin.clip_to_allocation = true;
        const artIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 28,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        artBin.set_child(artIcon);
        actor.add_child(artBin);

        const titleLabel = new St.Label({text: 'Nothing Playing', style_class: 'macos-control-center-media-title'});
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        actor.add_child(titleLabel);

        const artistLabel = new St.Label({text: '', style_class: 'macos-control-center-media-artist'});
        artistLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        actor.add_child(artistLabel);

        const transportRow = new St.BoxLayout({style_class: 'macos-control-center-media-transport', x_expand: true});
        actor.add_child(transportRow);

        const prevButton = this._createTransportButton('media-skip-backward-symbolic', () => this._media.previous());
        const playButton = this._createTransportButton('media-playback-start-symbolic', () => this._media.playPause());
        const nextButton = this._createTransportButton('media-skip-forward-symbolic', () => this._media.next());
        transportRow.add_child(prevButton.button);
        transportRow.add_child(playButton.button);
        transportRow.add_child(nextButton.button);

        return {actor, artIcon, titleLabel, artistLabel, prevButton, playButton, nextButton};
    }

    _createTransportButton(iconName, onActivate) {
        const button = new St.Button({style_class: 'macos-control-center-transport-button', reactive: true, can_focus: true});
        button.connect('clicked', onActivate);
        const icon = new St.Icon({icon_name: iconName, icon_size: 14, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        button.set_child(icon);
        return {button, icon};
    }

    _updateMedia(state) {
        this._mediaCard.titleLabel.text = state.isActive ? state.title : 'Nothing Playing';
        this._mediaCard.artistLabel.text = state.isActive ? state.artist : '';
        this._mediaCard.playButton.icon.icon_name = state.isPlaying
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._mediaCard.prevButton.button.reactive = state.isActive && state.canGoPrevious;
        this._mediaCard.nextButton.button.reactive = state.isActive && state.canGoNext;
        this._mediaCard.playButton.button.reactive = state.isActive && state.canTogglePlayback;

        if (state.artIcon) {
            this._mediaCard.artIcon.gicon = state.artIcon;
        } else {
            this._mediaCard.artIcon.gicon = null;
            this._mediaCard.artIcon.icon_name = 'audio-x-generic-symbolic';
        }
    }
```

- [ ] **Step 4: Phase 4 checkpoint — hand back to the user**

Ask the user to reload GNOME Shell, then:
- With nothing playing, confirm the media card shows "Nothing Playing" and the transport buttons are disabled (not clickable/greyed).
- Start playing something in an MPRIS-capable app (e.g. a YouTube/Spotify Web Player tab in Firefox, or `mpv`/`vlc`/Spotify desktop if installed) and confirm: title/artist appear, the play/pause icon reflects state, Previous/Next enable or disable per what the player reports, and clicking Previous/Play-Pause/Next actually controls playback.
- If the track has artwork, confirm it renders (allow a moment for `http(s)://` art to fetch).
- If two players are active at once, confirm the card follows whichever one you last interacted with (played/paused/skipped).

If the media card doesn't populate, check `journalctl --user -b 0 | grep -iE 'mpris|control.center'` for the actual bus name your player exposes — some players are slow to appear on the bus after starting playback.

- [ ] **Step 5: Commit**

```bash
git add lib/mediaPlayerController.js lib/controlCenterIndicator.js stylesheet.css
git commit -m "Add MPRIS media card to the Control Center"
```
