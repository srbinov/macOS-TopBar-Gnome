# macOS-style Top Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GNOME Shell extension that replaces the stock top bar with a macOS-style menu bar (Apple menu, app name, static File/Edit/View/Window/Help, and battery/Wi-Fi/Control Center/date/time on the right).

**Architecture:** A single extension modifies `Main.panel`'s three existing box containers (`_leftBox`, `_centerBox`, `_rightBox`) in place on `enable()`: clears them, builds custom actors, and re-populates. `disable()` destroys the custom actors and restores the original children exactly as snapshotted. Battery and Wi-Fi are fully custom widgets reading live data directly from UPower and NetworkManager; the Control Center icon reuses GNOME's real Quick Settings button, relocated rather than rebuilt.

**Tech Stack:** GJS (ESM extension format), GNOME Shell 50 UI modules (`PanelMenu`, `PopupMenu`), `gi://St`, `gi://Clutter`, `gi://GLib`, `gi://Shell`, `gi://Meta`, `gi://NM`, `gi://UPowerGlib`/`gi://Gio` (D-Bus).

## Global Constraints

- Target: GNOME Shell 50.x, Wayland, Ubuntu 26.04 (`metadata.json` `shell-version: ["50"]`).
- Extension is for personal use only — it uses a real Apple glyph (trademark), so it must never be packaged for or submitted to extensions.gnome.org.
- File/Edit/View/Window/Help are static, non-interactive labels — never wired to real per-app menus.
- Battery and Wi-Fi indicators read live data directly from UPower/NetworkManager — they do not reuse GNOME's Quick Settings indicator objects or popups. The Control Center icon is the one exception: it reuses the real `Main.panel.statusArea.quickSettings` button, relocated.
- `enable()`/`disable()` must be idempotent and leave `Main.panel` in exactly its original state after `disable()` — verified by toggling on/off repeatedly.
- Repo root **is** the extension source directory (no `src/` nesting) so it can be symlinked directly into `~/.local/share/gnome-shell/extensions/<uuid>/`.
- Extension UUID: `macos-top-panel@local.dev`.
- Pure-logic modules (`lib/panelState.js`, `lib/clockFormat.js`, `lib/batteryData.js`, `lib/wifiData.js`) must have zero `gi://`/`resource://` imports so they're runnable and testable with plain `gjs -m` outside a running Shell. UI-glue modules that do import Shell/GI APIs are verified manually inside a nested test session — GJS run standalone has no access to `resource:///org/gnome/shell/...` (that GResource is only registered inside a real `gnome-shell` process).

---

## Task 1: Extension scaffold and dev loop

**Files:**
- Create: `metadata.json`
- Create: `extension.js`
- Create: `stylesheet.css`

**Interfaces:**
- Produces: a loadable (but inert) extension with UUID `macos-top-panel@local.dev`, ready for later tasks to fill in `enable()`/`disable()`.

- [ ] **Step 1: Write `metadata.json`**

```json
{
    "uuid": "macos-top-panel@local.dev",
    "name": "macOS-style Top Panel",
    "description": "Replaces the GNOME top bar with a macOS-style menu bar. Personal use only.",
    "shell-version": ["50"]
}
```

- [ ] **Step 2: Write a minimal `extension.js`**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        console.log('[macos-top-panel] enable() called');
    }

    disable() {
        console.log('[macos-top-panel] disable() called');
    }
}
```

- [ ] **Step 3: Write an empty `stylesheet.css`**

```css
/* macOS-style top panel — styling added incrementally in later tasks */
```

- [ ] **Step 4: Symlink the repo into the local extensions directory**

```bash
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/macos-top-panel@local.dev
```

Expected: `ls ~/.local/share/gnome-shell/extensions/` shows `macos-top-panel@local.dev` pointing at this repo.

- [ ] **Step 5: Verify it loads in an isolated nested session**

This creates a private D-Bus/dconf session so enabling the extension here has zero effect on your real desktop:

```bash
dbus-run-session -- bash
# inside the new shell:
gnome-extensions enable macos-top-panel@local.dev
gnome-shell --nested --wayland
```

Expected: a nested GNOME Shell window opens with no errors. In a second terminal, check for the two console.log lines:

```bash
journalctl --user -f -o cat | grep macos-top-panel
```

Close the nested window (or Ctrl+C) when confirmed. This nested-session loop is reused, unchanged, for every remaining task's manual verification step.

- [ ] **Step 6: Note any conflicting installed extensions**

Run `gnome-extensions list --enabled` and check for extensions that also manipulate the top bar (e.g. `dash-to-panel@jderose9.github.com`, if installed and enabled). If present, disable them **inside the nested test session only** (`gnome-extensions disable dash-to-panel@jderose9.github.com` inside the same `dbus-run-session` shell) before testing — they are not touched in your real session.

- [ ] **Step 7: Commit**

```bash
git add metadata.json extension.js stylesheet.css
git commit -m "Scaffold macOS-style top panel extension"
```

---

## Task 2: Panel state snapshot/restore (pure logic, TDD)

**Files:**
- Create: `lib/panelState.js`
- Test: `tests/panelState.test.js`

**Interfaces:**
- Produces: `snapshotBox(box)` → array of `{actor, visible}`; `clearBox(box)` → void; `restoreBox(box, snapshot)` → void. `box` is any object implementing `get_children()`, `add_child(actor)`, `remove_child(actor)` (duck-typed — real code passes an `St.BoxLayout`, tests pass a fake).

- [ ] **Step 1: Write the failing test**

```js
// tests/panelState.test.js
import {snapshotBox, clearBox, restoreBox} from '../lib/panelState.js';

class FakeActor {
    constructor(name, visible = true) {
        this.name = name;
        this.visible = visible;
    }
}

class FakeBox {
    constructor(children) {
        this._children = children;
    }
    get_children() {
        return this._children.slice();
    }
    add_child(actor) {
        this._children.push(actor);
    }
    remove_child(actor) {
        this._children = this._children.filter(c => c !== actor);
    }
}

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// snapshotBox captures actor + visibility for each child, in order
{
    const a1 = new FakeActor('a', true);
    const a2 = new FakeActor('b', false);
    const box = new FakeBox([a1, a2]);
    const snap = snapshotBox(box);
    assertEqual(snap.map(s => s.actor.name), ['a', 'b'], 'snapshotBox order');
    assertEqual(snap.map(s => s.visible), [true, false], 'snapshotBox visibility');
}

// clearBox empties the box
{
    const box = new FakeBox([new FakeActor('a'), new FakeActor('b')]);
    clearBox(box);
    assertEqual(box.get_children().length, 0, 'clearBox empties children');
}

// restoreBox puts the original children back, in order, with original visibility,
// even if the box was cleared and populated with different actors first, and even
// if the recorded actors' visibility was mutated in the meantime.
{
    const a1 = new FakeActor('a', true);
    const a2 = new FakeActor('b', false);
    const box = new FakeBox([a1, a2]);
    const snap = snapshotBox(box);

    clearBox(box);
    box.add_child(new FakeActor('custom-1'));
    a1.visible = false; // simulate something toggling it while detached

    restoreBox(box, snap);

    assertEqual(box.get_children().map(c => c.name), ['a', 'b'], 'restoreBox order');
    assertEqual(box.get_children().map(c => c.visible), [true, false], 'restoreBox visibility restored from snapshot');
}

print('All panelState tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/panelState.test.js`
Expected: fails with an import error (`lib/panelState.js` does not exist yet).

- [ ] **Step 3: Write the implementation**

```js
// lib/panelState.js

/**
 * @param {{get_children: () => object[]}} box
 * @returns {{actor: object, visible: boolean}[]}
 */
export function snapshotBox(box) {
    return box.get_children().map(actor => ({actor, visible: actor.visible}));
}

/**
 * @param {{get_children: () => object[], remove_child: (actor: object) => void}} box
 */
export function clearBox(box) {
    for (const actor of box.get_children())
        box.remove_child(actor);
}

/**
 * @param {{get_children: () => object[], remove_child: (actor: object) => void, add_child: (actor: object) => void}} box
 * @param {{actor: object, visible: boolean}[]} snapshot
 */
export function restoreBox(box, snapshot) {
    clearBox(box);
    for (const {actor, visible} of snapshot) {
        box.add_child(actor);
        actor.visible = visible;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/panelState.test.js`
Expected: three `PASS:` lines per block (9 total) and `All panelState tests passed.`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/panelState.js tests/panelState.test.js
git commit -m "Add panel box snapshot/restore logic with tests"
```

---

## Task 3: Wire panel state snapshot/restore into the real panel

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: `snapshotBox(box)`, `clearBox(box)`, `restoreBox(box, snapshot)` from `./lib/panelState.js`.
- Produces: `this._boxSnapshots` on the extension instance (used by every later task's `disable()` cleanup — later tasks only need to add/remove their own actors between the `clearBox` and `restoreBox` calls added here).

- [ ] **Step 1: Update `extension.js` to snapshot, clear, and restore the three boxes**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);
    }

    disable() {
        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 2: Manual verification in the nested session**

Using the same nested-session loop from Task 1 Step 5:

1. Launch the nested session with the extension already enabled.
2. Expected: the nested Shell's top bar is completely empty (no Activities, no clock, no status icons) — proof the boxes were cleared.
3. Inside the nested session, open a terminal and run `gnome-extensions disable macos-top-panel@local.dev`.
4. Expected: the top bar instantly returns to its normal stock appearance (Activities, clock, quick settings icon all back, in their original order).
5. Re-run `gnome-extensions enable macos-top-panel@local.dev` / `disable` two more times in a row.
6. Expected: no errors in `journalctl --user -f -o cat`, and the bar is empty/restored correctly every time — confirms idempotency.

- [ ] **Step 3: Commit**

```bash
git add extension.js
git commit -m "Wire panel box snapshot/restore into enable/disable"
```

---

## Task 4: Clock formatting (pure logic, TDD)

**Files:**
- Create: `lib/clockFormat.js`
- Test: `tests/clockFormat.test.js`

**Interfaces:**
- Produces: `formatMacDate(date)` → e.g. `"Wed Aug 5"`; `formatMacTime(date)` → e.g. `"10:42 PM"`. `date` is a plain JS `Date`.

- [ ] **Step 1: Write the failing test**

```js
// tests/clockFormat.test.js
import {formatMacDate, formatMacTime} from '../lib/clockFormat.js';

function assertEqual(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`FAIL: ${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
    print(`PASS: ${msg}`);
}

// formatMacDate
assertEqual(formatMacDate(new Date(2026, 7, 5)), 'Wed Aug 5', 'formatMacDate: Wed Aug 5 2026');
assertEqual(formatMacDate(new Date(2026, 0, 1)), 'Thu Jan 1', 'formatMacDate: Thu Jan 1 2026');
assertEqual(formatMacDate(new Date(2026, 11, 25)), 'Fri Dec 25', 'formatMacDate: Fri Dec 25 2026');

// formatMacTime — 12-hour, no leading zero on hour, minute zero-padded, AM/PM
assertEqual(formatMacTime(new Date(2026, 7, 5, 0, 0)), '12:00 AM', 'formatMacTime: midnight');
assertEqual(formatMacTime(new Date(2026, 7, 5, 12, 0)), '12:00 PM', 'formatMacTime: noon');
assertEqual(formatMacTime(new Date(2026, 7, 5, 13, 5)), '1:05 PM', 'formatMacTime: 1:05 PM padded minute');
assertEqual(formatMacTime(new Date(2026, 7, 5, 9, 7)), '9:07 AM', 'formatMacTime: 9:07 AM');
assertEqual(formatMacTime(new Date(2026, 7, 5, 23, 59)), '11:59 PM', 'formatMacTime: 11:59 PM');

print('All clockFormat tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/clockFormat.test.js`
Expected: import error, `lib/clockFormat.js` does not exist.

- [ ] **Step 3: Write the implementation**

```js
// lib/clockFormat.js

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** @param {Date} date */
export function formatMacDate(date) {
    return `${DAY_NAMES[date.getDay()]} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/** @param {Date} date */
export function formatMacTime(date) {
    const rawHours = date.getHours();
    const hours = rawHours % 12 === 0 ? 12 : rawHours % 12;
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const period = rawHours < 12 ? 'AM' : 'PM';
    return `${hours}:${minutes} ${period}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/clockFormat.test.js`
Expected: 8 `PASS:` lines, `All clockFormat tests passed.`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/clockFormat.js tests/clockFormat.test.js
git commit -m "Add macOS-style date/time formatting with tests"
```

---

## Task 5: Clock widget UI, wired into the right box

**Files:**
- Create: `lib/clockWidget.js`
- Modify: `extension.js`

**Interfaces:**
- Consumes: `formatMacDate(date)`, `formatMacTime(date)` from `./lib/clockFormat.js`.
- Produces: `ClockWidget` (an `St.BoxLayout` subclass with a `destroy()` that stops its internal timer — inherited from `St.BoxLayout`/`Clutter.Actor`, but the timer must be removed manually, see implementation).

- [ ] **Step 1: Write `lib/clockWidget.js`**

```js
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {formatMacDate, formatMacTime} from './clockFormat.js';

export const ClockWidget = GObject.registerClass(
class ClockWidget extends St.BoxLayout {
    _init() {
        super._init({style_class: 'macos-clock'});

        this._dateLabel = new St.Label({
            style_class: 'macos-clock-date',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timeLabel = new St.Label({
            style_class: 'macos-clock-time',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._dateLabel);
        this.add_child(this._timeLabel);

        this._update();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('destroy', () => {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = null;
            }
        });
    }

    _update() {
        const now = new Date();
        this._dateLabel.text = formatMacDate(now);
        this._timeLabel.text = formatMacTime(now);
    }
});
```

- [ ] **Step 2: Add styling for the clock widget in `stylesheet.css`**

```css
.macos-clock {
    spacing: 6px;
    padding: 0 8px;
}

.macos-clock-date,
.macos-clock-time {
    font-size: 13px;
}
```

- [ ] **Step 3: Wire `ClockWidget` into `extension.js`'s right box**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        this._clockWidget.destroy();
        this._clockWidget = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 4: Manual verification in the nested session**

1. Launch the nested session (Task 1 Step 5 loop) with the extension enabled.
2. Expected: right side of the bar shows today's date and current time, macOS-style (e.g. `Wed Aug 5   10:42 PM`), updating each minute (wait ~60s or change the system clock briefly to confirm the update path runs).
3. Disable the extension inside the nested session.
4. Expected: clock widget disappears, stock bar restored, no errors in `journalctl --user -f -o cat`.

- [ ] **Step 5: Commit**

```bash
git add lib/clockWidget.js extension.js stylesheet.css
git commit -m "Add custom clock widget to right box"
```

---

## Task 6: Battery data parsing (pure logic, TDD)

**Files:**
- Create: `lib/batteryData.js`
- Test: `tests/batteryData.test.js`

**Interfaces:**
- Produces: `parseBatteryState(props)` → `{hasBattery, percentage, charging, statusLabel}`. `props` is a plain object `{isPresent, percentage, state, timeToEmpty, timeToFull}` mirroring UPower's DisplayDevice D-Bus properties (`state` uses UPower's numeric `DeviceState` enum: `0` unknown, `1` charging, `2` discharging, `3` empty, `4` fully charged, `5` pending charge, `6` pending discharge; `timeToEmpty`/`timeToFull` are seconds).
- Also produces: `formatDuration(seconds)` → `"H:MM"` string, used internally and exported for direct testing.

- [ ] **Step 1: Write the failing test**

```js
// tests/batteryData.test.js
import {parseBatteryState, formatDuration} from '../lib/batteryData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// formatDuration
assertEqual(formatDuration(5446), '1:31', 'formatDuration: 5446s -> 1:31');
assertEqual(formatDuration(60), '0:01', 'formatDuration: 60s -> 0:01');
assertEqual(formatDuration(0), '0:00', 'formatDuration: 0s -> 0:00');

// no battery present -> hasBattery false, rest of the fields don't matter
{
    const result = parseBatteryState({isPresent: false, percentage: 0, state: 0, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.hasBattery, false, 'no battery: hasBattery false');
}

// charging with a known time-to-full
{
    const result = parseBatteryState({isPresent: true, percentage: 18, state: 1, timeToEmpty: 0, timeToFull: 5446});
    assertEqual(result.hasBattery, true, 'charging: hasBattery true');
    assertEqual(result.charging, true, 'charging: charging true');
    assertEqual(result.percentage, 18, 'charging: percentage 18');
    assertEqual(result.statusLabel, '18% (1:31 until full)', 'charging: statusLabel with time-to-full');
}

// discharging with a known time-to-empty
{
    const result = parseBatteryState({isPresent: true, percentage: 64, state: 2, timeToEmpty: 3600, timeToFull: 0});
    assertEqual(result.charging, false, 'discharging: charging false');
    assertEqual(result.statusLabel, '64% (1:00 remaining)', 'discharging: statusLabel with time-to-empty');
}

// fully charged
{
    const result = parseBatteryState({isPresent: true, percentage: 100, state: 4, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.charging, false, 'fully charged: charging false');
    assertEqual(result.statusLabel, '100% (Fully Charged)', 'fully charged: statusLabel');
}

// discharging with no time estimate available yet
{
    const result = parseBatteryState({isPresent: true, percentage: 47, state: 2, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.statusLabel, '47%', 'discharging, no estimate: statusLabel is bare percentage');
}

// percentage gets rounded
{
    const result = parseBatteryState({isPresent: true, percentage: 63.7, state: 2, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.percentage, 64, 'percentage rounds to nearest integer');
}

print('All batteryData tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/batteryData.test.js`
Expected: import error, `lib/batteryData.js` does not exist.

- [ ] **Step 3: Write the implementation**

```js
// lib/batteryData.js

const DeviceState = {
    UNKNOWN: 0,
    CHARGING: 1,
    DISCHARGING: 2,
    EMPTY: 3,
    FULLY_CHARGED: 4,
    PENDING_CHARGE: 5,
    PENDING_DISCHARGE: 6,
};

/** @param {number} seconds */
export function formatDuration(seconds) {
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * @param {{isPresent: boolean, percentage: number, state: number, timeToEmpty: number, timeToFull: number}} props
 */
export function parseBatteryState(props) {
    const hasBattery = props.isPresent;
    const percentage = Math.round(props.percentage);
    const charging = props.state === DeviceState.CHARGING || props.state === DeviceState.PENDING_CHARGE;

    let statusLabel;
    if (props.state === DeviceState.FULLY_CHARGED) {
        statusLabel = `${percentage}% (Fully Charged)`;
    } else if (charging) {
        statusLabel = props.timeToFull > 0
            ? `${percentage}% (${formatDuration(props.timeToFull)} until full)`
            : `${percentage}% (Charging)`;
    } else if (props.state === DeviceState.DISCHARGING && props.timeToEmpty > 0) {
        statusLabel = `${percentage}% (${formatDuration(props.timeToEmpty)} remaining)`;
    } else {
        statusLabel = `${percentage}%`;
    }

    return {hasBattery, percentage, charging, statusLabel};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/batteryData.test.js`
Expected: 9 `PASS:` lines, `All batteryData tests passed.`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/batteryData.js tests/batteryData.test.js
git commit -m "Add battery state parsing logic with tests"
```

---

## Task 7: Battery indicator UI, wired into the right box

**Files:**
- Create: `lib/batteryIndicator.js`
- Modify: `extension.js`

**Interfaces:**
- Consumes: `parseBatteryState(props)` from `./lib/batteryData.js`.
- Produces: `BatteryIndicator` (a `PanelMenu.Button` subclass). Exposes no extra public methods beyond the standard `PanelMenu.Button` surface (`.container`, `.menu`, `.destroy()`) — later tasks add it to `Main.panel.menuManager` and add `.container` to a box, exactly like Task 11/12's Apple/App-name buttons.

- [ ] **Step 1: Write `lib/batteryIndicator.js`**

```js
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseBatteryState} from './batteryData.js';

const UPOWER_BUS_NAME = 'org.freedesktop.UPower';
const DISPLAY_DEVICE_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const DISPLAY_DEVICE_IFACE = 'org.freedesktop.UPower.Device';

export const BatteryIndicator = GObject.registerClass(
class BatteryIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Battery');

        this._icon = new St.Icon({icon_name: 'battery-symbolic', style_class: 'system-status-icon'});
        this._label = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        const box = new St.BoxLayout();
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._menuItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._menuItem);

        this.hide();

        this._proxy = null;
        this._propsChangedId = 0;
        Gio.DBusProxy.new(
            Gio.DBus.system, Gio.DBusProxyFlags.NONE, null,
            UPOWER_BUS_NAME, DISPLAY_DEVICE_PATH, DISPLAY_DEVICE_IFACE, null,
            (source, result) => {
                try {
                    this._proxy = Gio.DBusProxy.new_finish(result);
                    this._propsChangedId = this._proxy.connect('g-properties-changed', () => this._update());
                    this._update();
                } catch (e) {
                    logError(e, '[macos-top-panel] failed to connect to UPower');
                }
            });

        this.connect('destroy', () => {
            if (this._proxy && this._propsChangedId)
                this._proxy.disconnect(this._propsChangedId);
            this._proxy = null;
        });
    }

    _update() {
        if (!this._proxy)
            return;

        const props = {
            isPresent: this._proxy.get_cached_property('IsPresent')?.unpack() ?? false,
            percentage: this._proxy.get_cached_property('Percentage')?.unpack() ?? 0,
            state: this._proxy.get_cached_property('State')?.unpack() ?? 0,
            timeToEmpty: this._proxy.get_cached_property('TimeToEmpty')?.unpack() ?? 0,
            timeToFull: this._proxy.get_cached_property('TimeToFull')?.unpack() ?? 0,
        };

        const state = parseBatteryState(props);

        if (!state.hasBattery) {
            this.hide();
            return;
        }

        this.show();
        this._label.text = `${state.percentage}%`;
        this._icon.icon_name = state.charging ? 'battery-charging-symbolic' : 'battery-symbolic';
        this._menuItem.label.text = state.statusLabel;
    }
});
```

- [ ] **Step 2: Wire `BatteryIndicator` into `extension.js`**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._batteryIndicator = new BatteryIndicator();
        Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
        Main.panel._rightBox.add_child(this._batteryIndicator.container);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        this._clockWidget.destroy();
        this._clockWidget = null;

        Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator.destroy();
        this._batteryIndicator = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 3: Manual verification in the nested session**

1. Launch the nested session with the extension enabled, on a laptop with a battery.
2. Expected: a battery icon + percentage appears left of the clock; clicking it opens a dropdown showing the same percentage plus charging state and a time estimate (e.g. `18% (1:31 until full)` while plugged in and charging).
3. Unplug/plug the charger (or, if testing on a desktop with no battery, confirm the icon simply never appears).
4. Expected: the label and dropdown text update within a few seconds of the charging state changing (driven by the `g-properties-changed` signal).
5. Disable the extension.
6. Expected: battery indicator disappears, stock bar restored, no errors in `journalctl --user -f -o cat`.

- [ ] **Step 4: Commit**

```bash
git add lib/batteryIndicator.js extension.js
git commit -m "Add custom battery indicator reading live UPower data"
```

---

## Task 8: Wi-Fi data parsing (pure logic, TDD)

**Files:**
- Create: `lib/wifiData.js`
- Test: `tests/wifiData.test.js`

**Interfaces:**
- Produces: `parseWifiState(props)` → `{enabled, connected, ssid, strength, statusLabel}`. `props` is a plain object `{wirelessEnabled, ssid, strength}` where `ssid` is `string|null` and `strength` is `number|null` (0-100) — already converted from `GBytes`/GObject types by the caller, so this module has no GI dependency.

- [ ] **Step 1: Write the failing test**

```js
// tests/wifiData.test.js
import {parseWifiState} from '../lib/wifiData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// wifi off
{
    const result = parseWifiState({wirelessEnabled: false, ssid: null, strength: null});
    assertEqual(result.enabled, false, 'off: enabled false');
    assertEqual(result.connected, false, 'off: connected false');
    assertEqual(result.statusLabel, 'Wi-Fi Off', 'off: statusLabel');
}

// on, not connected
{
    const result = parseWifiState({wirelessEnabled: true, ssid: null, strength: null});
    assertEqual(result.enabled, true, 'on/disconnected: enabled true');
    assertEqual(result.connected, false, 'on/disconnected: connected false');
    assertEqual(result.statusLabel, 'Not Connected', 'on/disconnected: statusLabel');
}

// connected, excellent signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 85});
    assertEqual(result.connected, true, 'connected: connected true');
    assertEqual(result.ssid, 'Archer50', 'connected: ssid');
    assertEqual(result.statusLabel, 'Archer50 (Excellent)', 'connected: excellent signal label');
}

// connected, good signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 63});
    assertEqual(result.statusLabel, 'Archer50 (Good)', 'connected: good signal label');
}

// connected, fair signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 35});
    assertEqual(result.statusLabel, 'Archer50 (Fair)', 'connected: fair signal label');
}

// connected, weak signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 10});
    assertEqual(result.statusLabel, 'Archer50 (Weak)', 'connected: weak signal label');
}

print('All wifiData tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/wifiData.test.js`
Expected: import error, `lib/wifiData.js` does not exist.

- [ ] **Step 3: Write the implementation**

```js
// lib/wifiData.js

/** @param {number} strength 0-100 */
function strengthLabel(strength) {
    if (strength >= 80)
        return 'Excellent';
    if (strength >= 55)
        return 'Good';
    if (strength >= 30)
        return 'Fair';
    return 'Weak';
}

/**
 * @param {{wirelessEnabled: boolean, ssid: string|null, strength: number|null}} props
 */
export function parseWifiState(props) {
    const enabled = props.wirelessEnabled;
    const connected = enabled && props.ssid != null;

    let statusLabel;
    if (!enabled)
        statusLabel = 'Wi-Fi Off';
    else if (!connected)
        statusLabel = 'Not Connected';
    else
        statusLabel = `${props.ssid} (${strengthLabel(props.strength)})`;

    return {enabled, connected, ssid: props.ssid, strength: props.strength, statusLabel};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/wifiData.test.js`
Expected: 10 `PASS:` lines, `All wifiData tests passed.`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/wifiData.js tests/wifiData.test.js
git commit -m "Add wifi state parsing logic with tests"
```

---

## Task 9: Wi-Fi indicator UI, wired into the right box

**Files:**
- Create: `lib/wifiIndicator.js`
- Modify: `extension.js`

**Interfaces:**
- Consumes: `parseWifiState(props)` from `./lib/wifiData.js`.
- Produces: `WifiIndicator` (a `PanelMenu.Button` subclass), same public surface as `BatteryIndicator`.

- [ ] **Step 1: Write `lib/wifiIndicator.js`**

```js
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

        NM.Client.new_async(null, (source, result) => {
            try {
                this._client = NM.Client.new_finish(result);
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
            for (const [obj, id] of this._signalIds)
                obj.disconnect(id);
            this._signalIds = [];
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
});
```

- [ ] **Step 2: Wire `WifiIndicator` into `extension.js`**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._batteryIndicator = new BatteryIndicator();
        Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
        Main.panel._rightBox.add_child(this._batteryIndicator.container);

        this._wifiIndicator = new WifiIndicator();
        Main.panel.menuManager.addMenu(this._wifiIndicator.menu);
        Main.panel._rightBox.add_child(this._wifiIndicator.container);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        this._clockWidget.destroy();
        this._clockWidget = null;

        Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator.destroy();
        this._wifiIndicator = null;

        Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator.destroy();
        this._batteryIndicator = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 3: Manual verification in the nested session**

1. Launch the nested session with the extension enabled, on a machine connected to Wi-Fi.
2. Expected: a Wi-Fi icon appears between the battery icon and the clock; clicking it shows the real SSID and a signal-quality word (e.g. `Archer50 (Good)`), plus an on/off switch.
3. Toggle the switch off.
4. Expected: real Wi-Fi disconnects (verify with `nmcli device status` in a normal terminal), icon/label update to `Wi-Fi Off`.
5. Toggle back on and confirm it reconnects and the label updates back to the SSID.
6. Disable the extension.
7. Expected: Wi-Fi indicator disappears, stock bar restored, no errors in `journalctl --user -f -o cat`.

- [ ] **Step 4: Commit**

```bash
git add lib/wifiIndicator.js extension.js
git commit -m "Add custom wifi indicator reading live NetworkManager data"
```

---

## Task 10: Control Center — relocate the real Quick Settings button

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: `Main.panel.statusArea.quickSettings` (the real, already-constructed stock indicator).
- Produces: nothing new — this task only changes ordering/parenting inside `enable()`/`disable()`.

- [ ] **Step 1: Reparent the stock Quick Settings button in `enable()`, restore its position in `disable()`**

The stock `quickSettings` button is already a child of `Main.panel._rightBox` before our `clearBox` call runs, so `snapshotBox` (Task 3) already recorded its original position — `restoreBox` on `disable()` puts it back automatically, with no special-casing needed there. `enable()` only needs to re-add it, in the right slot, after `clearBox` detaches it:

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._batteryIndicator = new BatteryIndicator();
        Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
        Main.panel._rightBox.add_child(this._batteryIndicator.container);

        this._wifiIndicator = new WifiIndicator();
        Main.panel.menuManager.addMenu(this._wifiIndicator.menu);
        Main.panel._rightBox.add_child(this._wifiIndicator.container);

        // Control Center: reuse the real stock Quick Settings button, just relocated.
        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings.container.show();
        Main.panel._rightBox.add_child(quickSettings.container);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        this._clockWidget.destroy();
        this._clockWidget = null;

        Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator.destroy();
        this._wifiIndicator = null;

        Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator.destroy();
        this._batteryIndicator = null;

        // Do NOT destroy quickSettings.container — it's the real stock object,
        // restoreBox() below puts it back where it came from.
        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 2: Manual verification in the nested session**

1. Launch the nested session with the extension enabled.
2. Expected: the Control Center icon appears between the Wi-Fi icon and the clock; it looks and behaves exactly like stock GNOME's Quick Settings icon (same icons for volume/network/etc. inside it), because it *is* that object.
3. Click it — expected: the real Quick Settings popup opens with working toggles.
4. Disable the extension.
5. Expected: the Quick Settings button reappears in its original stock position on the right, fully functional, with no duplicate or broken instance anywhere.

- [ ] **Step 3: Commit**

```bash
git add extension.js
git commit -m "Relocate stock Quick Settings button into Control Center slot"
```

---

## Task 11: Apple menu button

**Files:**
- Create: `lib/systemMenu.js`
- Modify: `extension.js`

**Interfaces:**
- Consumes: `SystemActions.getDefault()` from `resource:///org/gnome/shell/misc/systemActions.js` (methods used: `activateLockScreen()`, `activateSuspend()`, `activateRestart()`, `activatePowerOff()`, `activateLogout()`).
- Produces: `AppleMenuButton` (a `PanelMenu.Button` subclass), same public surface as `BatteryIndicator`/`WifiIndicator`.

- [ ] **Step 1: Write `lib/systemMenu.js`**

```js
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

export const AppleMenuButton = GObject.registerClass(
class AppleMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Apple Menu');

        this.add_child(new St.Label({text: '', style_class: 'macos-apple-glyph'}));

        const aboutItem = new PopupMenu.PopupMenuItem('About This Computer');
        aboutItem.connect('activate', () => this._showAbout());
        this.menu.addMenuItem(aboutItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings…');
        settingsItem.connect('activate', () => {
            Gio.Subprocess.new(['gnome-control-center'], Gio.SubprocessFlags.NONE);
        });
        this.menu.addMenuItem(settingsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const actions = SystemActions.getDefault();
        const actionItems = [
            ['Lock Screen', () => actions.activateLockScreen()],
            ['Suspend', () => actions.activateSuspend()],
            ['Restart…', () => actions.activateRestart()],
            ['Shut Down…', () => actions.activatePowerOff()],
            ['Log Out…', () => actions.activateLogout()],
        ];
        for (const [label, callback] of actionItems) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', callback);
            this.menu.addMenuItem(item);
        }
    }

    _showAbout() {
        const osName = GLib.get_os_info('PRETTY_NAME') ?? 'Unknown OS';
        const hostName = GLib.get_host_name();
        Main.notify('About This Computer', `${osName}\n${hostName}`);
    }
});
```

- [ ] **Step 2: Add styling for the Apple glyph in `stylesheet.css`**

```css
.macos-apple-glyph {
    font-size: 16px;
    padding: 0 10px;
}
```

- [ ] **Step 3: Wire `AppleMenuButton` into `extension.js`'s left box**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';
import {AppleMenuButton} from './lib/systemMenu.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._appleMenu = new AppleMenuButton();
        Main.panel.menuManager.addMenu(this._appleMenu.menu);
        Main.panel._leftBox.add_child(this._appleMenu.container);

        this._batteryIndicator = new BatteryIndicator();
        Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
        Main.panel._rightBox.add_child(this._batteryIndicator.container);

        this._wifiIndicator = new WifiIndicator();
        Main.panel.menuManager.addMenu(this._wifiIndicator.menu);
        Main.panel._rightBox.add_child(this._wifiIndicator.container);

        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings.container.show();
        Main.panel._rightBox.add_child(quickSettings.container);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        this._clockWidget.destroy();
        this._clockWidget = null;

        Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator.destroy();
        this._wifiIndicator = null;

        Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator.destroy();
        this._batteryIndicator = null;

        Main.panel.menuManager.removeMenu(this._appleMenu.menu);
        this._appleMenu.destroy();
        this._appleMenu = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 4: Manual verification in the nested session**

1. Launch the nested session with the extension enabled.
2. Expected: an Apple glyph is the leftmost item in the bar.
3. Click it → About This Computer: expected a notification bubble showing the real OS name and hostname (verify against `cat /etc/os-release | grep PRETTY_NAME` and `hostname` run in a normal terminal).
4. Click Settings…: expected GNOME Settings launches.
5. Click Lock Screen: expected the nested session locks (unlock to continue testing).
6. Do **not** click Restart/Shut Down/Log Out during nested testing unless you intend to end the nested session — confirm the menu items are present and correctly labeled instead of activating them, or only activate Log Out at the very end of this step since it just closes the nested session harmlessly.
7. Disable the extension and confirm the bar restores cleanly.

- [ ] **Step 5: Commit**

```bash
git add lib/systemMenu.js extension.js stylesheet.css
git commit -m "Add Apple menu button with system actions"
```

---

## Task 12: App name button

**Files:**
- Create: `lib/appNameIndicator.js`
- Modify: `extension.js`

**Interfaces:**
- Consumes: `Shell.WindowTracker.get_default()` (`gi://Shell`), `global.display.focus_window` (`Meta.Window`, via the global `global` object).
- Produces: `AppNameButton` (a `PanelMenu.Button` subclass), same public surface as the other custom buttons.

- [ ] **Step 1: Write `lib/appNameIndicator.js`**

```js
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const AppNameButton = GObject.registerClass(
class AppNameButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'App Name');

        this._label = new St.Label({text: '', style_class: 'macos-app-name', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._label);

        const quitItem = new PopupMenu.PopupMenuItem('Quit');
        quitItem.connect('activate', () => this._quitFocusedApp());
        this.menu.addMenuItem(quitItem);

        const hideItem = new PopupMenu.PopupMenuItem('Hide');
        hideItem.connect('activate', () => this._hideFocusedApp());
        this.menu.addMenuItem(hideItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const aboutItem = new PopupMenu.PopupMenuItem('About');
        aboutItem.connect('activate', () => this._aboutFocusedApp());
        this.menu.addMenuItem(aboutItem);

        this._tracker = Shell.WindowTracker.get_default();
        this._focusAppChangedId = this._tracker.connect('notify::focus-app', () => this._update());
        this._update();

        this.connect('destroy', () => {
            this._tracker.disconnect(this._focusAppChangedId);
        });
    }

    _update() {
        const app = this._tracker.focus_app;
        this._label.text = app ? app.get_name() : '';
    }

    _quitFocusedApp() {
        const win = global.display.focus_window;
        if (win)
            win.delete(global.get_current_time());
    }

    _hideFocusedApp() {
        const win = global.display.focus_window;
        if (win)
            win.minimize();
    }

    _aboutFocusedApp() {
        const app = this._tracker.focus_app;
        if (app)
            Main.notify(app.get_name(), 'No further details available.');
    }
});
```

- [ ] **Step 2: Add styling for the app name label in `stylesheet.css`**

```css
.macos-app-name {
    font-weight: bold;
    padding: 0 8px;
}
```

- [ ] **Step 3: Wire `AppNameButton` into `extension.js`'s left box, after the Apple menu**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';
import {AppleMenuButton} from './lib/systemMenu.js';
import {AppNameButton} from './lib/appNameIndicator.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._appleMenu = new AppleMenuButton();
        Main.panel.menuManager.addMenu(this._appleMenu.menu);
        Main.panel._leftBox.add_child(this._appleMenu.container);

        this._appNameButton = new AppNameButton();
        Main.panel.menuManager.addMenu(this._appNameButton.menu);
        Main.panel._leftBox.add_child(this._appNameButton.container);

        this._batteryIndicator = new BatteryIndicator();
        Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
        Main.panel._rightBox.add_child(this._batteryIndicator.container);

        this._wifiIndicator = new WifiIndicator();
        Main.panel.menuManager.addMenu(this._wifiIndicator.menu);
        Main.panel._rightBox.add_child(this._wifiIndicator.container);

        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings.container.show();
        Main.panel._rightBox.add_child(quickSettings.container);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        this._clockWidget.destroy();
        this._clockWidget = null;

        Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator.destroy();
        this._wifiIndicator = null;

        Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator.destroy();
        this._batteryIndicator = null;

        Main.panel.menuManager.removeMenu(this._appNameButton.menu);
        this._appNameButton.destroy();
        this._appNameButton = null;

        Main.panel.menuManager.removeMenu(this._appleMenu.menu);
        this._appleMenu.destroy();
        this._appleMenu = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 4: Manual verification in the nested session**

1. Launch the nested session with the extension enabled.
2. Open two different apps (e.g. Terminal and Text Editor) inside the nested session and switch focus between them.
3. Expected: the bold label right after the Apple glyph updates to match whichever app is currently focused.
4. Click the app name → About: expected a notification with the app's name.
5. Click Hide: expected the focused window minimizes.
6. Restore it, click Quit: expected the focused window closes.
7. Click on the desktop background (no window focused) — expected the label goes blank rather than erroring (check `journalctl --user -f -o cat` for exceptions).
8. Disable the extension and confirm the bar restores cleanly.

- [ ] **Step 5: Commit**

```bash
git add lib/appNameIndicator.js extension.js stylesheet.css
git commit -m "Add focused-app name button with Quit/Hide/About menu"
```

---

## Task 13: Static File/Edit/View/Window/Help labels

**Files:**
- Create: `lib/staticMenuBar.js`
- Modify: `extension.js`

**Interfaces:**
- Produces: `StaticMenuBar` (an `St.BoxLayout` subclass, same shape as `ClockWidget` — no `.container`/`.menu`, added to the box directly).

- [ ] **Step 1: Write `lib/staticMenuBar.js`**

```js
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const LABELS = ['File', 'Edit', 'View', 'Window', 'Help'];

export const StaticMenuBar = GObject.registerClass(
class StaticMenuBar extends St.BoxLayout {
    _init() {
        super._init({style_class: 'macos-static-menu-bar'});

        for (const text of LABELS) {
            this.add_child(new St.Label({
                text,
                style_class: 'macos-static-menu-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
    }
});
```

- [ ] **Step 2: Add styling in `stylesheet.css`**

```css
.macos-static-menu-bar {
    spacing: 14px;
}

.macos-static-menu-label {
    font-size: 13px;
}
```

- [ ] **Step 3: Wire `StaticMenuBar` into `extension.js`'s left box, after the app name button**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';
import {AppleMenuButton} from './lib/systemMenu.js';
import {AppNameButton} from './lib/appNameIndicator.js';
import {StaticMenuBar} from './lib/staticMenuBar.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._appleMenu = new AppleMenuButton();
        Main.panel.menuManager.addMenu(this._appleMenu.menu);
        Main.panel._leftBox.add_child(this._appleMenu.container);

        this._appNameButton = new AppNameButton();
        Main.panel.menuManager.addMenu(this._appNameButton.menu);
        Main.panel._leftBox.add_child(this._appNameButton.container);

        this._staticMenuBar = new StaticMenuBar();
        Main.panel._leftBox.add_child(this._staticMenuBar);

        this._batteryIndicator = new BatteryIndicator();
        Main.panel.menuManager.addMenu(this._batteryIndicator.menu);
        Main.panel._rightBox.add_child(this._batteryIndicator.container);

        this._wifiIndicator = new WifiIndicator();
        Main.panel.menuManager.addMenu(this._wifiIndicator.menu);
        Main.panel._rightBox.add_child(this._wifiIndicator.container);

        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings.container.show();
        Main.panel._rightBox.add_child(quickSettings.container);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        this._clockWidget.destroy();
        this._clockWidget = null;

        Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator.destroy();
        this._wifiIndicator = null;

        Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator.destroy();
        this._batteryIndicator = null;

        this._staticMenuBar.destroy();
        this._staticMenuBar = null;

        Main.panel.menuManager.removeMenu(this._appNameButton.menu);
        this._appNameButton.destroy();
        this._appNameButton = null;

        Main.panel.menuManager.removeMenu(this._appleMenu.menu);
        this._appleMenu.destroy();
        this._appleMenu = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
```

- [ ] **Step 4: Manual verification in the nested session**

1. Launch the nested session with the extension enabled.
2. Expected: `File  Edit  View  Window  Help` appear after the app name, in that order, and stay identical regardless of which app is focused (switch focus between apps to confirm — unlike the app name label, these never change).
3. Click on one of the labels — expected: nothing happens (no menu, no error).
4. Disable the extension and confirm the bar restores cleanly.

- [ ] **Step 5: Commit**

```bash
git add lib/staticMenuBar.js extension.js stylesheet.css
git commit -m "Add static File/Edit/View/Window/Help labels"
```

---

## Task 14: Final styling and full walkthrough

**Files:**
- Modify: `stylesheet.css`
- Modify: `extension.js` (only if the walkthrough surfaces a bug)

**Interfaces:**
- None new — this task is verification and visual polish only.

- [ ] **Step 1: Tighten overall spacing/fonts to read as one coherent bar**

```css
/* macOS-style top panel */

.macos-apple-glyph {
    font-size: 16px;
    padding: 0 10px;
}

.macos-app-name {
    font-weight: bold;
    padding: 0 8px;
}

.macos-static-menu-bar {
    spacing: 14px;
    padding-left: 4px;
}

.macos-static-menu-label {
    font-size: 13px;
}

.macos-clock {
    spacing: 6px;
    padding: 0 10px;
}

.macos-clock-date,
.macos-clock-time {
    font-size: 13px;
}
```

- [ ] **Step 2: Run every automated test together**

```bash
for f in tests/*.test.js; do echo "=== $f ==="; gjs -m "$f" || exit 1; done
echo "All automated tests passed."
```

Expected: all four suites (`panelState`, `clockFormat`, `batteryData`, `wifiData`) print their `PASS` lines and the final "All automated tests passed." line, with a `0` exit code.

- [ ] **Step 3: Full manual walkthrough in the nested session**

Using the Task 1 Step 5 loop, with the extension enabled:

1. Confirm the full bar left-to-right: Apple glyph, bold focused-app name, `File Edit View Window Help`, then on the right: battery %, Wi-Fi, Control Center, date, time — matching the order specified in the design.
2. Toggle Wi-Fi off via `nmcli radio wifi off` in a plain terminal (outside the nested session) — expected: the custom Wi-Fi icon updates to `Wi-Fi Off` within a few seconds; turn it back on with `nmcli radio wifi on` and confirm it recovers.
3. If testing on a desktop with no battery: confirm the battery icon never renders and no error appears in `journalctl --user -f -o cat`.
4. Click on the empty desktop background so no window has focus — confirm the app-name label goes blank and nothing throws.
5. Toggle the extension off and on five times in a row via `gnome-extensions disable`/`enable` — confirm the bar is pixel-identical to the very first enable each time, and `journalctl --user -f -o cat` shows no errors across all five cycles.
6. Disable the extension one final time and confirm the stock GNOME bar — Activities button, dateMenu clock, Quick Settings icon — is back exactly as it was before Task 1 Step 4's symlink was created.

- [ ] **Step 4: Commit**

```bash
git add stylesheet.css
git commit -m "Polish top panel styling; complete full walkthrough verification"
```
