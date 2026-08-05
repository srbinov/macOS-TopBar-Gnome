# Panel Customization & Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the base extension's alignment/duplicate-icon bugs, apply the user's SF Pro Display font, and add a real GNOME Preferences window covering per-indicator visibility/size and three panel background modes — including one that dynamically samples and matches the color of whatever window touches the top of the screen.

**Architecture:** Bug fixes and font installation extend the existing `extension.js`/`lib/*.js` structure from the base plan. A new GSettings schema backs a `prefs.js` (GTK4/libadwaita) preferences window; `extension.js` reads the schema on `enable()`, applies it to each indicator via a new `setScale(scale)` method added to every indicator class, and live-reapplies on GSettings `changed`. A new `WindowColorBlend` controller samples screen color via `Shell.Screenshot.pick_color()` when the "blend" background mode is active.

**Tech Stack:** Same as the base extension (GJS, GNOME Shell 50 UI modules) plus GTK4/libadwaita (`gi://Adw`, `gi://Gtk`, `gi://Gdk`) for `prefs.js`, `Gio.Settings`/GSettings schemas, and `gi://Shell`'s `Shell.Screenshot.pick_color()`.

## Global Constraints

- Builds on the already-merged base extension in this repo (`extension.js`, `lib/*.js`, `stylesheet.css`, `metadata.json`, `tests/*.test.js` — all present on `master`).
- Extension UUID stays `macos-top-panel@local.dev`; personal use only, same as the base extension.
- Free-form pixel positioning is explicitly OUT of scope — indicators stay in GNOME's normal left-to-right box layout; only visibility and size (font-size/icon-size scale, 0.5x–2.0x) are user-configurable, not position.
- Pure-logic modules (`lib/colorUtil.js`) must have zero `gi://`/`resource://` imports, testable with plain `gjs -m`, matching the base extension's established pattern.
- No subagent may run `gnome-extensions enable`/`disable`, `gsettings`/`dconf` commands touching `org.gnome.shell` keys, or launch `gnome-shell` itself — this caused a real leak into the developer's live desktop settings during the base extension's build and must not be repeated. Opening the Preferences window (`gnome-extensions prefs <uuid>`) is a real GUI action deferred to the human, same reasoning.
- Reading/writing this extension's OWN GSettings schema (`org.gnome.shell.extensions.macos-top-panel`) via `gio settings --schemadir=schemas get ...` is safe and may be used for verification — it's a private namespace, not `org.gnome.shell`'s own keys, and doesn't affect whether the extension is loaded.
- GSettings schema id: `org.gnome.shell.extensions.macos-top-panel`, path: `/org/gnome/shell/extensions/macos-top-panel/` — confirmed against real installed extensions' conventions (`blur-my-shell@aunetx`) during planning.
- `prefs.js` imports `ExtensionPreferences` from `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` (capital `Shell`/`Extensions`, different resource domain than `extension.js`'s lowercase `resource:///org/gnome/shell/...`) — confirmed against five real installed extensions' prefs.js files during planning, not guessed.
- `Adw.SwitchRow`, `Adw.SpinRow`, `Adw.ComboRow`, `Adw.PreferencesWindow`, and `Gtk.ColorDialogButton` were all confirmed present via live `gjs -m` import checks on this exact machine during planning.

---

## Task 1: Color/size formatting helpers (pure logic, TDD)

**Files:**
- Create: `lib/colorUtil.js`
- Test: `tests/colorUtil.test.js`

**Interfaces:**
- Produces: `scaleSize(baseSize, scale)` → integer, `scale` clamped to [0.5, 2.0]; `formatRgba({r, g, b, a})` → `"rgba(r, g, b, a)"` string; `parseRgba(str)` → `{r, g, b, a}` (inverse of `formatRgba`'s exact output format — not a general CSS color parser).

- [ ] **Step 1: Write the failing test**

```js
// tests/colorUtil.test.js
import {scaleSize, formatRgba, parseRgba} from '../lib/colorUtil.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// scaleSize
assertEqual(scaleSize(13, 1.0), 13, 'scaleSize: 1.0x unchanged');
assertEqual(scaleSize(13, 1.5), 20, 'scaleSize: 1.5x rounds to 20');
assertEqual(scaleSize(13, 0.5), 7, 'scaleSize: 0.5x rounds to 7');
assertEqual(scaleSize(13, 3.0), 26, 'scaleSize: clamps above 2.0 to 2.0x -> 26');
assertEqual(scaleSize(13, 0.1), 7, 'scaleSize: clamps below 0.5 to 0.5x -> 7');

// formatRgba
assertEqual(formatRgba({r: 20, g: 20, b: 20, a: 0.85}), 'rgba(20, 20, 20, 0.85)', 'formatRgba: basic');
assertEqual(formatRgba({r: 0, g: 0, b: 0, a: 1}), 'rgba(0, 0, 0, 1)', 'formatRgba: opaque black');
assertEqual(formatRgba({r: 255, g: 255, b: 255, a: 0}), 'rgba(255, 255, 255, 0)', 'formatRgba: transparent white');

// parseRgba
assertEqual(parseRgba('rgba(20, 20, 20, 0.85)'), {r: 20, g: 20, b: 20, a: 0.85}, 'parseRgba: basic');
assertEqual(parseRgba('rgba(0, 0, 0, 1)'), {r: 0, g: 0, b: 0, a: 1}, 'parseRgba: opaque black');

// round trip
{
    const original = {r: 15, g: 15, b: 15, a: 0.9};
    assertEqual(parseRgba(formatRgba(original)), original, 'round trip preserves value');
}

print('All colorUtil tests passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `gjs -m tests/colorUtil.test.js`
Expected: import error, `lib/colorUtil.js` does not exist.

- [ ] **Step 3: Write the implementation**

```js
// lib/colorUtil.js

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;

/** @param {number} baseSize @param {number} scale */
export function scaleSize(baseSize, scale) {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    return Math.round(baseSize * clamped);
}

/** @param {{r: number, g: number, b: number, a: number}} color */
export function formatRgba({r, g, b, a}) {
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** @param {string} str */
export function parseRgba(str) {
    const match = str.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    if (!match)
        throw new Error(`Invalid rgba string: ${str}`);
    return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: Number(match[4]),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `gjs -m tests/colorUtil.test.js`
Expected: 11 `PASS:` lines, `All colorUtil tests passed.`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/colorUtil.js tests/colorUtil.test.js
git commit -m "Add color/size formatting helpers with tests"
```

---

## Task 2: GSettings schema

**Files:**
- Create: `schemas/org.gnome.shell.extensions.macos-top-panel.gschema.xml`
- Modify: `metadata.json`
- Modify: `.gitignore` (create if absent)

**Interfaces:**
- Produces: 16 GSettings keys later tasks read: `apple-visible`/`apple-scale`, `app-name-visible`/`app-name-scale`, `static-menu-visible`/`static-menu-scale`, `battery-visible`/`battery-scale`, `wifi-visible`/`wifi-scale`, `control-center-visible`/`control-center-scale`, `clock-visible`/`clock-scale` (all `b`/`d` pairs), plus `background-mode` (`s`, one of `'color'|'transparent'|'blend'`) and `background-color` (`s`, an `formatRgba`-shaped string).

- [ ] **Step 1: Write the schema**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
    <schema id="org.gnome.shell.extensions.macos-top-panel" path="/org/gnome/shell/extensions/macos-top-panel/">
        <key type="b" name="apple-visible">
            <default>true</default>
            <summary>Show Apple menu</summary>
        </key>
        <key type="d" name="apple-scale">
            <default>1.0</default>
            <summary>Apple menu icon scale</summary>
        </key>
        <key type="b" name="app-name-visible">
            <default>true</default>
            <summary>Show focused app name</summary>
        </key>
        <key type="d" name="app-name-scale">
            <default>1.0</default>
            <summary>App name text scale</summary>
        </key>
        <key type="b" name="static-menu-visible">
            <default>true</default>
            <summary>Show File/Edit/View/Window/Help</summary>
        </key>
        <key type="d" name="static-menu-scale">
            <default>1.0</default>
            <summary>Static menu bar text scale</summary>
        </key>
        <key type="b" name="battery-visible">
            <default>true</default>
            <summary>Show battery indicator</summary>
        </key>
        <key type="d" name="battery-scale">
            <default>1.0</default>
            <summary>Battery indicator scale</summary>
        </key>
        <key type="b" name="wifi-visible">
            <default>true</default>
            <summary>Show Wi-Fi indicator</summary>
        </key>
        <key type="d" name="wifi-scale">
            <default>1.0</default>
            <summary>Wi-Fi indicator scale</summary>
        </key>
        <key type="b" name="control-center-visible">
            <default>true</default>
            <summary>Show Control Center button</summary>
        </key>
        <key type="d" name="control-center-scale">
            <default>1.0</default>
            <summary>Control Center icon scale</summary>
        </key>
        <key type="b" name="clock-visible">
            <default>true</default>
            <summary>Show clock</summary>
        </key>
        <key type="d" name="clock-scale">
            <default>1.0</default>
            <summary>Clock text scale</summary>
        </key>
        <key type="s" name="background-mode">
            <default>'color'</default>
            <summary>Panel background mode: color, transparent, or blend</summary>
        </key>
        <key type="s" name="background-color">
            <default>'rgba(15, 15, 15, 0.9)'</default>
            <summary>Panel background color (used by color mode, and as the idle look for blend mode)</summary>
        </key>
    </schema>
</schemalist>
```

- [ ] **Step 2: Compile the schema and verify it, read-only**

```bash
glib-compile-schemas --strict schemas/
gio settings --schemadir=schemas list-keys org.gnome.shell.extensions.macos-top-panel
gio settings --schemadir=schemas get org.gnome.shell.extensions.macos-top-panel background-color
```

Expected: `glib-compile-schemas` produces no output (success) and creates `schemas/gschemas.compiled`; `list-keys` prints all 16 key names; `get background-color` prints `'rgba(15, 15, 15, 0.9)'`. This only reads this extension's own private settings namespace via `--schemadir` — it does not touch `org.gnome.shell`'s real settings or any dconf state the running Shell reads from.

- [ ] **Step 3: Add `settings-schema` to metadata.json**

Read the current file first — it's:
```json
{
    "uuid": "macos-top-panel@local.dev",
    "name": "macOS-style Top Panel",
    "description": "Replaces the GNOME top bar with a macOS-style menu bar. Personal use only.",
    "shell-version": ["50"]
}
```

Change it to:
```json
{
    "uuid": "macos-top-panel@local.dev",
    "name": "macOS-style Top Panel",
    "description": "Replaces the GNOME top bar with a macOS-style menu bar. Personal use only.",
    "shell-version": ["50"],
    "settings-schema": "org.gnome.shell.extensions.macos-top-panel"
}
```

- [ ] **Step 4: Gitignore the compiled schema artifact**

Create `.gitignore` (or append if it already exists) with:
```
schemas/gschemas.compiled
```

- [ ] **Step 5: Commit**

```bash
git add schemas/org.gnome.shell.extensions.macos-top-panel.gschema.xml metadata.json .gitignore
git commit -m "Add GSettings schema for panel preferences"
```

---

## Task 3: Custom Control Center button (fixes duplicate battery/wifi icon bug)

**Files:**
- Create: `lib/controlCenterButton.js`
- Modify: `extension.js`
- Modify: `stylesheet.css`

**Interfaces:**
- Produces: `ControlCenterButton` (a `PanelMenu.Button` subclass with `dontCreateMenu: true` — no `.menu` of its own beyond the stub `PopupDummyMenu`; clicking it opens the real `Main.panel.statusArea.quickSettings.menu` instead).
- Consumes: nothing new from earlier base-extension tasks beyond what's already in `extension.js`.

- [ ] **Step 1: Write `lib/controlCenterButton.js`**

```js
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const ControlCenterButton = GObject.registerClass(
class ControlCenterButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Control Center', true);
        this.add_style_class_name('macos-menu-item');

        this._icon = new St.Icon({
            icon_name: 'preferences-system-symbolic',
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        const clickGesture = new Clutter.ClickGesture();
        clickGesture.set_recognize_on_press(true);
        clickGesture.connect('recognize', () => {
            Main.panel.statusArea.quickSettings.menu.open();
        });
        this.add_action(clickGesture);
    }
});
```

- [ ] **Step 2: Add the shared `.macos-menu-item` class to `stylesheet.css`**

Add this rule (anywhere in the file; Task 4 reorganizes the whole file, this is just getting the class defined now so Step 3 below doesn't render unstyled):

```css
.macos-menu-item {
    padding: 0 8px;
}
```

- [ ] **Step 3: Replace the Quick Settings reparenting in `extension.js` with the new button**

Read the current file first — the relevant `enable()` block currently reads:
```js
            // Control Center: reuse the real stock Quick Settings button, just relocated.
            const quickSettings = Main.panel.statusArea.quickSettings;
            quickSettings.container.show();
            Main.panel._rightBox.add_child(quickSettings.container);
```

Replace those three lines with:
```js
            this._controlCenter = new ControlCenterButton();
            Main.panel._rightBox.add_child(this._controlCenter.container);
```

Add the import at the top of the file, alongside the other `lib/` imports:
```js
import {ControlCenterButton} from './lib/controlCenterButton.js';
```

In `disable()`, the current comment and restore-only handling reads:
```js
        // Do NOT destroy quickSettings.container — it's the real stock object,
        // restoreBox() below puts it back where it came from.
        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
```

Replace it with a destroy call for the new button plus the same restore call:
```js
        this._controlCenter?.destroy();
        this._controlCenter = null;

        // The real stock quickSettings.container was detached (never destroyed)
        // by clearBox() at the top of enable() and was never re-added anywhere
        // by this extension — restoreBox() below puts it back where it came from.
        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
```

- [ ] **Step 4: Manual verification (deferred to human — do not attempt as a subagent)**

Note in the report: this task cannot be verified live by a subagent (requires launching gnome-shell). Verify with static review only: confirm `lib/controlCenterButton.js` has no syntax errors (`gjs -m lib/controlCenterButton.js` — expect only a `resource://` resolution failure, not a JS syntax error) and that `extension.js` no longer references `quickSettings.container.show()`/`add_child` anywhere.

- [ ] **Step 5: Commit**

```bash
git add lib/controlCenterButton.js extension.js stylesheet.css
git commit -m "Replace relocated Quick Settings button with custom Control Center icon"
```

---

## Task 4: Alignment and spacing fixes

**Files:**
- Modify: `lib/systemMenu.js`
- Modify: `lib/appNameIndicator.js`
- Modify: `lib/batteryIndicator.js`
- Modify: `lib/wifiIndicator.js`
- Modify: `stylesheet.css`

**Interfaces:**
- No new exports — this task only fixes existing rendering.

- [ ] **Step 1: Fix the Apple glyph's missing vertical centering in `lib/systemMenu.js`**

Read the current file first. Add `Clutter` to the imports (currently missing):
```js
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
```

Change this line:
```js
        this.add_child(new St.Label({text: '', style_class: 'macos-apple-glyph'}));
```
to store the label and center it (needed by Task 7 too, which adds `setScale`):
```js
        this._glyphLabel = new St.Label({
            text: '',
            style_class: 'macos-apple-glyph',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._glyphLabel);
```

Immediately after the `super._init(0.0, 'Apple Menu');` line, add:
```js
        this.add_style_class_name('macos-menu-item');
```

- [ ] **Step 2: Add the shared menu-item class to `lib/appNameIndicator.js`**

Read the current file first. Immediately after `super._init(0.0, 'App Name');`, add:
```js
        this.add_style_class_name('macos-menu-item');
```

- [ ] **Step 3: Fix spacing and add the shared class in `lib/batteryIndicator.js`**

Read the current file first. Change:
```js
        this._icon = new St.Icon({icon_name: 'battery-symbolic', style_class: 'system-status-icon'});
        this._label = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        const box = new St.BoxLayout();
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);
```
to:
```js
        this._icon = new St.Icon({
            icon_name: 'battery-symbolic',
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            text: '',
            style_class: 'macos-indicator-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const box = new St.BoxLayout({style_class: 'macos-indicator-box'});
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);
```

Immediately after `super._init(0.5, 'Battery');`, add:
```js
        this.add_style_class_name('macos-menu-item');
```

- [ ] **Step 4: Add vertical centering and the shared class in `lib/wifiIndicator.js`**

Read the current file first. Change:
```js
        this._icon = new St.Icon({icon_name: 'network-wireless-symbolic', style_class: 'system-status-icon'});
```
to:
```js
        this._icon = new St.Icon({
            icon_name: 'network-wireless-symbolic',
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
```

Immediately after `super._init(0.5, 'Wi-Fi');`, add:
```js
        this.add_style_class_name('macos-menu-item');
```

- [ ] **Step 5: Rewrite `stylesheet.css` with a consistent spacing rhythm**

Replace the entire file with:
```css
/* macOS-style top panel */

#panel {
    font-family: "SF Pro Display";
}

.macos-menu-item {
    padding: 0 8px;
}

.macos-apple-glyph {
    font-size: 16px;
}

.macos-app-name {
    font-weight: bold;
}

.macos-static-menu-bar {
    spacing: 16px;
    padding-left: 4px;
}

.macos-static-menu-label {
    font-size: 13px;
}

.macos-indicator-box {
    spacing: 4px;
}

.macos-indicator-label {
    font-size: 13px;
}

.macos-clock {
    spacing: 6px;
    padding: 0 8px;
}

.macos-clock-date,
.macos-clock-time {
    font-size: 13px;
}
```

(The `#panel { font-family: "SF Pro Display"; }` rule is added now so Task 6's font installation has somewhere to take effect; until Task 5/6 actually install the font, Pango falls back to the system default since the family won't be found yet — this is expected and harmless.)

- [ ] **Step 6: Verify no syntax errors**

```bash
gjs -m lib/systemMenu.js
gjs -m lib/appNameIndicator.js
gjs -m lib/batteryIndicator.js
gjs -m lib/wifiIndicator.js
```
Expected: each fails only with a `resource://` resolution error, not a JS syntax error.

- [ ] **Step 7: Commit**

```bash
git add lib/systemMenu.js lib/appNameIndicator.js lib/batteryIndicator.js lib/wifiIndicator.js stylesheet.css
git commit -m "Fix panel alignment and normalize spacing across all indicators"
```

---

## Task 5: Font installer

**Files:**
- Create: `lib/fontInstaller.js`

**Interfaces:**
- Produces: `ensureFontInstalled()` — idempotent, no return value. Copies the SF Pro Display family into `~/.local/share/fonts/` and refreshes the font cache, unless already done (tracked via a marker file).

**Note on verification:** unlike most UI-glue in this codebase, this function is safe to actually execute during development — it only touches `~/.local/share/fonts/` and runs `fc-cache`, neither of which touches GNOME Shell state, dconf, or `enabled-extensions`. Run it for real.

- [ ] **Step 1: Write `lib/fontInstaller.js`**

```js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const SOURCE_DIR = GLib.build_filenamev([GLib.get_home_dir(), 'Downloads', 'OPENSOURCEFREEFONTSDOTCOM']);
const FONT_FILES = [
    'FREEFONTONEREGULAR.OTF',
    'FREEFONTONEMEDIUM.OTF',
    'FREEFONTONEBOLD.OTF',
    'SFPRODISPLAYULTRALIGHTITALIC.OTF',
    'SFPRODISPLAYTHINITALIC.OTF',
    'SFPRODISPLAYLIGHTITALIC.OTF',
    'SFPRODISPLAYSEMIBOLDITALIC.OTF',
    'SFPRODISPLAYHEAVYITALIC.OTF',
    'SFPRODISPLAYBLACKITALIC.OTF',
];
const DEST_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'fonts']);
const MARKER_PATH = GLib.build_filenamev([DEST_DIR, '.macos-top-panel-font-installed']);

/**
 * Copies the SF Pro Display family into ~/.local/share/fonts and refreshes
 * the font cache. Safe to call on every enable() — does nothing once the
 * marker file exists. Never throws; logs and returns on any failure so a
 * missing font never blocks the panel from loading.
 */
export function ensureFontInstalled() {
    const markerFile = Gio.File.new_for_path(MARKER_PATH);
    if (markerFile.query_exists(null))
        return;

    const destDir = Gio.File.new_for_path(DEST_DIR);
    try {
        if (!destDir.query_exists(null))
            destDir.make_directory_with_parents(null);
    } catch (e) {
        logError(e, '[macos-top-panel] could not create fonts directory');
        return;
    }

    let copiedAny = false;
    for (const fileName of FONT_FILES) {
        const sourceFile = Gio.File.new_for_path(GLib.build_filenamev([SOURCE_DIR, fileName]));
        if (!sourceFile.query_exists(null)) {
            logError(new Error(`[macos-top-panel] font source missing: ${fileName}`));
            continue;
        }
        const destFile = Gio.File.new_for_path(GLib.build_filenamev([DEST_DIR, fileName]));
        try {
            sourceFile.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
            copiedAny = true;
        } catch (e) {
            logError(e, `[macos-top-panel] failed to copy ${fileName}`);
        }
    }

    if (!copiedAny)
        return;

    try {
        const proc = Gio.Subprocess.new(['fc-cache', '-f', DEST_DIR], Gio.SubprocessFlags.NONE);
        proc.wait(null);
    } catch (e) {
        logError(e, '[macos-top-panel] fc-cache failed');
    }

    try {
        markerFile.replace_contents('installed', null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        logError(e, '[macos-top-panel] failed to write font install marker');
    }
}
```

- [ ] **Step 2: Actually run it and verify the font gets installed**

```bash
cd /home/chris/codingprojects/panel
cat > /tmp/run-font-install.js << 'EOF'
import {ensureFontInstalled} from '/home/chris/codingprojects/panel/lib/fontInstaller.js';
ensureFontInstalled();
print('done');
EOF
gjs -m /tmp/run-font-install.js
fc-list | grep -i "SF Pro Display"
ls -la ~/.local/share/fonts/ | grep -iE "FREEFONTONE|SFPRODISPLAY"
cat ~/.local/share/fonts/.macos-top-panel-font-installed
```

Expected: `fc-list` prints 9 lines (one per installed weight/style), the `ls` shows all 9 `.OTF` files copied into `~/.local/share/fonts/`, and the marker file exists with contents `installed`. Clean up the temp script afterward: `rm /tmp/run-font-install.js`.

- [ ] **Step 3: Run it a second time to confirm idempotency**

```bash
gjs -m /tmp/run-font-install.js 2>&1 || echo "(temp script already removed, that's fine — re-create it if you want to re-test)"
```

If you kept the temp script from Step 2, re-running should do nothing (marker file already exists, function returns immediately) — no errors, no duplicate work. This step is optional if the temp script was already cleaned up; the idempotency guard (`if (markerFile.query_exists(null)) return;`) is visible directly in the code from Step 1.

- [ ] **Step 4: Commit**

```bash
git add lib/fontInstaller.js
git commit -m "Add SF Pro Display font installer"
```

---

## Task 6: Wire font installation into the extension

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: `ensureFontInstalled()` from `./lib/fontInstaller.js` (Task 5).

- [ ] **Step 1: Call the font installer at the top of `enable()`**

Read the current file first. Add the import alongside the others:
```js
import {ensureFontInstalled} from './lib/fontInstaller.js';
```

Inside `enable()`'s `try` block, as the very first statement (before the `this._boxSnapshots = {...}` assignment), add:
```js
            try {
                ensureFontInstalled();
            } catch (e) {
                logError(e, '[macos-top-panel] font installation failed, continuing without it');
            }
```

This local try/catch means a font-install failure is logged but never blocks the rest of `enable()` (and, since it's caught locally, never triggers the outer catch's rollback either) — matching the design spec's error-handling requirement that a missing font falls back to the system default rather than breaking the panel.

- [ ] **Step 2: Verify no syntax errors**

```bash
gjs -m extension.js
```
Expected: fails only with a `resource://` resolution error, not a JS syntax error.

- [ ] **Step 3: Commit**

```bash
git add extension.js
git commit -m "Wire font installer into extension enable()"
```

---

## Task 7: Add setScale() to every indicator class

**Files:**
- Modify: `lib/systemMenu.js`
- Modify: `lib/appNameIndicator.js`
- Modify: `lib/staticMenuBar.js`
- Modify: `lib/batteryIndicator.js`
- Modify: `lib/wifiIndicator.js`
- Modify: `lib/controlCenterButton.js`
- Modify: `lib/clockWidget.js`

**Interfaces:**
- Consumes: `scaleSize(baseSize, scale)` from `./colorUtil.js` (Task 1) in every file below.
- Produces: `setScale(scale)` on all 7 classes — uniform signature `(scale: number) => void`, later consumed identically by `extension.js` in Task 8's settings-apply loop.

- [ ] **Step 1: Add `setScale` to `lib/systemMenu.js`**

Read the current file first (as left by Task 4 — it now has `this._glyphLabel` and imports `Clutter`). Add the import:
```js
import {scaleSize} from './colorUtil.js';
```

Add this method inside the `AppleMenuButton` class, after `_showAbout()`:
```js
    setScale(scale) {
        this._glyphLabel.style = `font-size: ${scaleSize(16, scale)}px;`;
    }
```

- [ ] **Step 2: Add `setScale` to `lib/appNameIndicator.js`**

Read the current file first. Add the import:
```js
import {scaleSize} from './colorUtil.js';
```

Add this method inside the `AppNameButton` class, after `_aboutFocusedApp()`:
```js
    setScale(scale) {
        this._label.style = `font-size: ${scaleSize(13, scale)}px;`;
    }
```

- [ ] **Step 3: Add `setScale` to `lib/staticMenuBar.js`, storing label references**

Read the current file first — it's:
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

Replace the whole file with:
```js
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {scaleSize} from './colorUtil.js';

const LABELS = ['File', 'Edit', 'View', 'Window', 'Help'];

export const StaticMenuBar = GObject.registerClass(
class StaticMenuBar extends St.BoxLayout {
    _init() {
        super._init({style_class: 'macos-static-menu-bar'});

        this._labels = [];
        for (const text of LABELS) {
            const label = new St.Label({
                text,
                style_class: 'macos-static-menu-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(label);
            this._labels.push(label);
        }
    }

    setScale(scale) {
        const size = scaleSize(13, scale);
        for (const label of this._labels)
            label.style = `font-size: ${size}px;`;
    }
});
```

- [ ] **Step 4: Add `setScale` to `lib/batteryIndicator.js`**

Read the current file first (as left by Task 4 — it now has `.macos-indicator-label`/`.macos-indicator-box` classes). Add the import:
```js
import {scaleSize} from './colorUtil.js';
```

Add this method inside the `BatteryIndicator` class, after `_update()`:
```js
    setScale(scale) {
        this._icon.icon_size = scaleSize(16, scale);
        this._label.style = `font-size: ${scaleSize(13, scale)}px;`;
    }
```

- [ ] **Step 5: Add `setScale` to `lib/wifiIndicator.js`**

Read the current file first. Add the import:
```js
import {scaleSize} from './colorUtil.js';
```

Add this method inside the `WifiIndicator` class, after `_update()`:
```js
    setScale(scale) {
        this._icon.icon_size = scaleSize(16, scale);
    }
```

- [ ] **Step 6: Add `setScale` to `lib/controlCenterButton.js`**

Read the current file first (from Task 3). Add the import:
```js
import {scaleSize} from './colorUtil.js';
```

Add this method inside the `ControlCenterButton` class:
```js
    setScale(scale) {
        this._icon.icon_size = scaleSize(16, scale);
    }
```

- [ ] **Step 7: Add `setScale` to `lib/clockWidget.js`**

Read the current file first. Add the import:
```js
import {scaleSize} from './colorUtil.js';
```

Add this method inside the `ClockWidget` class, after `_update()`:
```js
    setScale(scale) {
        const size = scaleSize(13, scale);
        this._dateLabel.style = `font-size: ${size}px;`;
        this._timeLabel.style = `font-size: ${size}px;`;
    }
```

- [ ] **Step 8: Verify no syntax errors across all seven files**

```bash
for f in lib/systemMenu.js lib/appNameIndicator.js lib/staticMenuBar.js lib/batteryIndicator.js lib/wifiIndicator.js lib/controlCenterButton.js lib/clockWidget.js; do
    echo "=== $f ==="
    gjs -m "$f" 2>&1 | head -3
done
```
Expected: every file fails only with a `resource://` resolution error (for the files that import Shell UI modules) or, for files with no such import, exits cleanly — never a JS syntax error.

- [ ] **Step 9: Commit**

```bash
git add lib/systemMenu.js lib/appNameIndicator.js lib/staticMenuBar.js lib/batteryIndicator.js lib/wifiIndicator.js lib/controlCenterButton.js lib/clockWidget.js
git commit -m "Add setScale() to every indicator for GSettings-driven sizing"
```

---

## Task 8: Wire GSettings (visibility, scale, static background) into extension.js

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: `this.getSettings()` (from the `Extension` base class — confirmed present, reads `metadata['settings-schema']`); every indicator's `setScale(scale)` (Task 7); `formatRgba`/`parseRgba` not needed here (background-color is stored and applied as a ready-to-use CSS string already).
- Produces: `this._settings`, `this._applyElementSettings()`, `this._applyBackground()` on the extension instance — Task 10 calls `this._applyBackground()`'s pattern again when wiring the dynamic blend mode.

- [ ] **Step 1: Rewrite `extension.js`**

Read the current file first (as left by Tasks 3 and 6). Replace the whole file with:

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
import {ControlCenterButton} from './lib/controlCenterButton.js';
import {ensureFontInstalled} from './lib/fontInstaller.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        try {
            try {
                ensureFontInstalled();
            } catch (e) {
                logError(e, '[macos-top-panel] font installation failed, continuing without it');
            }

            try {
                this._settings = this.getSettings();
            } catch (e) {
                logError(e, '[macos-top-panel] GSettings schema unavailable, using built-in defaults');
                this._settings = null;
            }

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

            this._controlCenter = new ControlCenterButton();
            Main.panel._rightBox.add_child(this._controlCenter.container);

            this._clockWidget = new ClockWidget();
            Main.panel._rightBox.add_child(this._clockWidget);

            if (this._settings) {
                this._applyElementSettings();
                this._applyBackground();

                this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                    if (key === 'background-mode' || key === 'background-color')
                        this._applyBackground();
                    else
                        this._applyElementSettings();
                });
            }
            // If this._settings is null (schema unavailable), every element keeps
            // the fully-visible, 1.0x-scale, stock-background state it already has
            // from its own constructor — a working panel with no customization,
            // rather than a broken enable().
        } catch (e) {
            logError(e, '[macos-top-panel] enable() failed, rolling back');
            this.disable();
            throw e;
        }
    }

    disable() {
        if (!this._boxSnapshots)
            return;

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        this._settings = null;

        Main.panel.style = null;

        this._clockWidget?.destroy();
        this._clockWidget = null;

        this._controlCenter?.destroy();
        this._controlCenter = null;

        if (this._wifiIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator?.destroy();
        this._wifiIndicator = null;

        if (this._batteryIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator?.destroy();
        this._batteryIndicator = null;

        this._staticMenuBar?.destroy();
        this._staticMenuBar = null;

        if (this._appNameButton?.menu)
            Main.panel.menuManager.removeMenu(this._appNameButton.menu);
        this._appNameButton?.destroy();
        this._appNameButton = null;

        if (this._appleMenu?.menu)
            Main.panel.menuManager.removeMenu(this._appleMenu.menu);
        this._appleMenu?.destroy();
        this._appleMenu = null;

        // The real stock quickSettings.container was detached (never destroyed)
        // by clearBox() at the top of enable() and was never re-added anywhere
        // by this extension — restoreBox() below puts it back where it came from.
        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }

    _applyElementSettings() {
        const elements = [
            ['apple', this._appleMenu],
            ['app-name', this._appNameButton],
            ['static-menu', this._staticMenuBar],
            ['battery', this._batteryIndicator],
            ['wifi', this._wifiIndicator],
            ['control-center', this._controlCenter],
            ['clock', this._clockWidget],
        ];
        for (const [key, actor] of elements) {
            actor.visible = this._settings.get_boolean(`${key}-visible`);
            actor.setScale(this._settings.get_double(`${key}-scale`));
        }
    }

    _applyBackground() {
        const mode = this._settings.get_string('background-mode');
        if (mode === 'transparent')
            Main.panel.style = 'background-color: transparent;';
        else
            Main.panel.style = `background-color: ${this._settings.get_string('background-color')};`;
    }
}
```

(This version handles `'color'` and `'transparent'` modes fully; `'blend'` mode falls back to the static color for now — Task 10 adds the dynamic sampling on top of this same `_applyBackground()`/`_applyElementSettings()` structure.)

- [ ] **Step 2: Verify no syntax errors**

```bash
gjs -m extension.js
```
Expected: fails only with a `resource://` resolution error, not a JS syntax error.

- [ ] **Step 3: Verify every existing automated test suite still passes (this task didn't touch any pure-logic module, but confirm nothing else broke)**

```bash
gjs -m tests/panelState.test.js && gjs -m tests/clockFormat.test.js && gjs -m tests/batteryData.test.js && gjs -m tests/wifiData.test.js && gjs -m tests/colorUtil.test.js
echo "ALL SUITES EXIT: $?"
```
Expected: all five suites pass, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add extension.js
git commit -m "Wire GSettings-driven visibility, scale, and static background into extension.js"
```

---

## Task 9: Preferences window

**Files:**
- Create: `prefs.js`

**Interfaces:**
- Consumes: `formatRgba`/`parseRgba` from `./lib/colorUtil.js` (Task 1); the schema from Task 2 (via `this.getSettings()`, same mechanism as `extension.js`).

- [ ] **Step 1: Write `prefs.js`**

```js
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {formatRgba, parseRgba} from './lib/colorUtil.js';

const ELEMENTS = [
    {key: 'apple', title: 'Apple Menu'},
    {key: 'app-name', title: 'App Name'},
    {key: 'static-menu', title: 'File/Edit/View/Window/Help'},
    {key: 'battery', title: 'Battery'},
    {key: 'wifi', title: 'Wi-Fi'},
    {key: 'control-center', title: 'Control Center'},
    {key: 'clock', title: 'Clock'},
];

const BACKGROUND_MODES = ['color', 'transparent', 'blend'];
const BACKGROUND_MODE_LABELS = ['Static Color', 'Transparent', 'Blends with Window'];

function rgbaSettingToGdk({r, g, b, a}) {
    const rgba = new Gdk.RGBA();
    rgba.red = r / 255;
    rgba.green = g / 255;
    rgba.blue = b / 255;
    rgba.alpha = a;
    return rgba;
}

export default class MacosTopPanelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const elementsPage = new Adw.PreferencesPage({
            title: 'Panel Elements',
            icon_name: 'view-list-symbolic',
        });
        const elementsGroup = new Adw.PreferencesGroup({title: 'Panel Elements'});
        elementsPage.add(elementsGroup);

        for (const {key, title} of ELEMENTS) {
            const visibleRow = new Adw.SwitchRow({title});
            settings.bind(`${key}-visible`, visibleRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            elementsGroup.add(visibleRow);

            const sizeRow = new Adw.SpinRow({
                title: `${title} Size`,
                adjustment: new Gtk.Adjustment({
                    lower: 0.5,
                    upper: 2.0,
                    step_increment: 0.1,
                    page_increment: 0.1,
                }),
                digits: 1,
            });
            settings.bind(`${key}-scale`, sizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
            elementsGroup.add(sizeRow);
        }

        const backgroundPage = new Adw.PreferencesPage({
            title: 'Background',
            icon_name: 'preferences-color-symbolic',
        });
        const backgroundGroup = new Adw.PreferencesGroup({title: 'Panel Background'});
        backgroundPage.add(backgroundGroup);

        const modeRow = new Adw.ComboRow({
            title: 'Mode',
            model: Gtk.StringList.new(BACKGROUND_MODE_LABELS),
            selected: BACKGROUND_MODES.indexOf(settings.get_string('background-mode')),
        });
        modeRow.connect('notify::selected', () => {
            settings.set_string('background-mode', BACKGROUND_MODES[modeRow.selected]);
        });
        settings.connect('changed::background-mode', () => {
            modeRow.selected = BACKGROUND_MODES.indexOf(settings.get_string('background-mode'));
        });
        backgroundGroup.add(modeRow);

        const colorRow = new Adw.ActionRow({title: 'Color (Static / Blend Idle)'});
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: true}),
            rgba: rgbaSettingToGdk(parseRgba(settings.get_string('background-color'))),
            valign: Gtk.Align.CENTER,
        });
        colorButton.connect('notify::rgba', () => {
            const {red, green, blue, alpha} = colorButton.rgba;
            settings.set_string('background-color', formatRgba({
                r: Math.round(red * 255),
                g: Math.round(green * 255),
                b: Math.round(blue * 255),
                a: Math.round(alpha * 100) / 100,
            }));
        });
        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;
        backgroundGroup.add(colorRow);

        window.add(elementsPage);
        window.add(backgroundPage);
    }
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
gjs -m prefs.js
```
Expected: fails only with a `resource://` resolution error (for the `ExtensionPreferences` import), not a JS syntax error.

- [ ] **Step 3: Manual verification (deferred to human)**

Note in the report: opening the actual Preferences window (`gnome-extensions prefs macos-top-panel@local.dev`) is a real GUI action and is deferred to the human's walkthrough in Task 11 — not something a subagent attempts.

- [ ] **Step 4: Commit**

```bash
git add prefs.js
git commit -m "Add Preferences window for panel elements and background"
```

---

## Task 10: Dynamic window-color blending

**Files:**
- Create: `lib/windowColorBlend.js`
- Modify: `extension.js`

**Interfaces:**
- Consumes: `formatRgba` from `./lib/colorUtil.js` (Task 1).
- Produces: `WindowColorBlend` — a plain (non-GObject) class with `enable()`/`disable()` lifecycle methods and a constructor `(getPanelRect, onColorChange)` where `getPanelRect()` returns `{x, y, width, height}` and `onColorChange(cssColorStringOrNull)` is called with a `formatRgba`-shaped CSS string when a window's color should override the background, or `null` when nothing is touching the top edge (caller should fall back to its static background).

- [ ] **Step 1: Write `lib/windowColorBlend.js`**

```js
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {formatRgba} from './colorUtil.js';

const DEBOUNCE_MS = 150;

/**
 * Watches for windows touching the top of the screen and reports a sampled
 * background color while one is; reports null when nothing is touching.
 */
export class WindowColorBlend {
    /**
     * @param {() => {x: number, y: number, width: number, height: number}} getPanelRect
     * @param {(cssColor: string|null) => void} onColorChange
     */
    constructor(getPanelRect, onColorChange) {
        this._getPanelRect = getPanelRect;
        this._onColorChange = onColorChange;
        this._signalIds = [];
        this._timeoutId = 0;
        this._isDestroyed = false;
    }

    enable() {
        const wm = global.window_manager;
        this._signalIds.push([wm, wm.connect('size-change', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('switch-workspace', () => this._scheduleCheck())]);
        this._signalIds.push([global.display,
            global.display.connect('notify::focus-window', () => this._scheduleCheck())]);
        this._signalIds.push([global.display,
            global.display.connect('window-created', () => this._scheduleCheck())]);
        this._scheduleCheck();
    }

    disable() {
        this._isDestroyed = true;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        for (const [obj, id] of this._signalIds)
            obj.disconnect(id);
        this._signalIds = [];
    }

    _scheduleCheck() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._timeoutId = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }

    _findTouchingWindow(panelRect) {
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().find(win => {
            if (win.minimized || win.get_window_type() !== Meta.WindowType.NORMAL)
                return false;
            const frame = win.get_frame_rect();
            const touchesTop = frame.y <= panelRect.y + panelRect.height;
            const overlapsHorizontally =
                frame.x < panelRect.x + panelRect.width && frame.x + frame.width > panelRect.x;
            return touchesTop && overlapsHorizontally;
        });
    }

    async _check() {
        if (this._isDestroyed)
            return;

        const panelRect = this._getPanelRect();
        const touching = this._findTouchingWindow(panelRect);

        if (!touching) {
            this._onColorChange(null);
            return;
        }

        const sampleX = Math.round(panelRect.x + panelRect.width / 2);
        const sampleY = panelRect.y + panelRect.height + 1;

        try {
            const screenshot = new Shell.Screenshot();
            const [color] = await screenshot.pick_color(sampleX, sampleY);
            if (this._isDestroyed)
                return;
            this._onColorChange(formatRgba({r: color.red, g: color.green, b: color.blue, a: 1}));
        } catch (e) {
            logError(e, '[macos-top-panel] pick_color failed');
        }
    }
}
```

**Verification caveat to note in the report:** `Shell.Screenshot.pick_color()`'s resolved color object's exact field convention (0-255 integers vs. 0-1 floats for `red`/`green`/`blue`) was confirmed via GNOME Shell 50.1's own source using it identically (`ui/screenshot.js`'s `PickPixel` class), but `Shell.Screenshot` cannot be meaningfully instantiated/tested outside a running Shell compositor process, so this can only be truly confirmed by the human's live walkthrough in Task 11. If the sampled colors look wrong (e.g., all near-zero or all near-255) during that walkthrough, the fix is dividing/multiplying by 255 in the `formatRgba({r: color.red, ...})` call above.

- [ ] **Step 2: Wire it into `extension.js`**

Read the current file first (as left by Task 8). Add the import:
```js
import {WindowColorBlend} from './lib/windowColorBlend.js';
```

Replace the `_applyBackground()` method:
```js
    _applyBackground() {
        const mode = this._settings.get_string('background-mode');
        if (mode === 'transparent')
            Main.panel.style = 'background-color: transparent;';
        else
            Main.panel.style = `background-color: ${this._settings.get_string('background-color')};`;
    }
```
with:
```js
    _applyBackground() {
        this._windowColorBlend?.disable();
        this._windowColorBlend = null;

        const mode = this._settings.get_string('background-mode');

        if (mode === 'transparent') {
            Main.panel.style = 'background-color: transparent;';
            return;
        }

        Main.panel.style = this._staticBackgroundStyle();

        if (mode === 'blend') {
            this._windowColorBlend = new WindowColorBlend(
                () => this._panelRect(),
                color => {
                    Main.panel.style = color ? `background-color: ${color};` : this._staticBackgroundStyle();
                });
            this._windowColorBlend.enable();
        }
    }

    _staticBackgroundStyle() {
        return `background-color: ${this._settings.get_string('background-color')};`;
    }

    _panelRect() {
        const [x, y] = Main.panel.get_transformed_position();
        const [width, height] = Main.panel.get_transformed_size();
        return {x, y, width, height};
    }
```

In `disable()`, immediately before the `Main.panel.style = null;` line, add:
```js
        this._windowColorBlend?.disable();
        this._windowColorBlend = null;
```

- [ ] **Step 3: Verify no syntax errors**

```bash
gjs -m lib/windowColorBlend.js
gjs -m extension.js
```
Expected: both fail only with a `resource://` resolution error, not a JS syntax error.

- [ ] **Step 4: Commit**

```bash
git add lib/windowColorBlend.js extension.js
git commit -m "Add dynamic window-color blending for the background"
```

---

## Task 11: Final integration and full walkthrough

**Files:**
- Modify: `stylesheet.css` (only if the walkthrough surfaces a real visual bug)

**Interfaces:**
- None new — this task is verification only.

- [ ] **Step 1: Run every automated test suite together**

```bash
for f in tests/*.test.js; do echo "=== $f ==="; gjs -m "$f" || exit 1; done
echo "All automated tests passed."
```
Expected: all five suites (`panelState`, `clockFormat`, `batteryData`, `wifiData`, `colorUtil`) print their `PASS` lines and the final line, exit code 0.

- [ ] **Step 2: Static syntax check every file that touches Shell/GTK resources**

```bash
for f in extension.js prefs.js lib/*.js; do
    echo "=== $f ==="
    gjs -m "$f" 2>&1 | head -3
done
```
Expected: every file fails only with a `resource://` resolution error (or, for pure files like `colorUtil.js`, exits cleanly) — never a JS syntax error.

- [ ] **Step 3: Full manual walkthrough (deferred to human — not a subagent step)**

Using the nested-session-free workflow already established for this project (log out/in, or `gnome-extensions enable/disable macos-top-panel@local.dev` in your real session — you already own that risk, unlike a subagent):

1. Confirm the Apple glyph is vertically centered and the whole bar reads as evenly spaced, matching the fixed alignment.
2. Confirm the Control Center icon (gear/sliders glyph) is the *only* thing near the right edge showing wifi/battery-style icons has been eliminated — no more duplicate battery/wifi glyphs.
3. Confirm the panel text renders in SF Pro Display (compare against a known SF Pro Display sample, or check `fc-match "SF Pro Display"` reports the installed font, not a fallback).
4. Run `gnome-extensions prefs macos-top-panel@local.dev` — confirm the Preferences window opens with two pages (Panel Elements, Background), all 7 switches default on, all 7 size sliders default to 1.0.
5. Toggle a few visibility switches off/on — confirm the corresponding panel element disappears/reappears live, no need to disable/re-enable the extension.
6. Move a size slider — confirm the corresponding element's text/icon visibly grows or shrinks live.
7. Switch background mode to Transparent — confirm the panel background becomes see-through. Switch to Static Color and pick a new color — confirm the panel background updates live to that color.
8. Switch background mode to Blends with Window — maximize a window (or snap it to the top half of the screen) and confirm the panel background changes to approximately match the color directly beneath it; un-maximize/move the window away from the top and confirm the panel falls back to the static color you last picked.
9. Toggle the extension off and on a few times — confirm the bar restores to the exact stock GNOME panel each time, with no leftover custom styling on `Main.panel` (checks the `Main.panel.style = null;` reset from Task 8/10).

- [ ] **Step 4: Commit any fixes found during the walkthrough**

If Step 3 finds a real visual bug, fix it in `stylesheet.css` (or the relevant `lib/*.js` file) and commit:
```bash
git add -A
git commit -m "Fix issues found during panel customization walkthrough"
```
If nothing needs fixing, this task ends at Step 2 with no additional commit.
