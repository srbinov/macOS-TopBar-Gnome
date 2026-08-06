# Merge Kiwi Menu + Global Menu for GNOME into the Top Panel Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-built stub Apple-menu (`lib/systemMenu.js`) and static File/Edit/View/Window/Help bar (`lib/staticMenuBar.js`) in this repo's `macos-top-panel@local.dev` extension with the real, fully-featured `kiwi-menu` (Apple-style system menu) and `global-menu-for-gnome` (live per-app File/Edit/View/Go/Window/Help bar) code the user imported, so the panel becomes one extension built from working components instead of stubs — while keeping the existing battery/wifi/clock/Quick-Settings indicators untouched.

**Architecture:** Kiwi Menu's runtime (`src/`, `app/`, `icons/`, `po/`, `prefs.css`) is vendored verbatim into the repo root — its internal file-path logic (`this._extensionPath` + `'src'`/`'app'`/`'icons'`) already assumes exactly this root-relative layout, so no path rewriting is needed. Global Menu's `menuManager.js` is self-contained (no filesystem paths) and moves into `lib/`. Global Menu's own redundant "System Menu" logo button (`systemMenu.js`) and this repo's now-redundant `AppNameButton` are dropped — Kiwi Menu's icon supplies the one system-menu button, and Global Menu's own "App" dropdown supplies the live focused-app name, so nothing duplicates. `extension.js` is rewritten to construct `KiwiMenu` (left, position 0) and `MenuManager` (left, positions 1+) side by side, driven by two separate GSettings schemas (`org.gnome.shell.extensions.kiwimenu`, trimmed `org.gnome.shell.extensions.globalmenu`) fetched via `this.getSettings(schemaId)`. A single merged `prefs.js` assembles a tabbed `Adw.PreferencesWindow` from both projects' existing page-builder code, trimmed of the dropped logo-button settings.

**Tech Stack:** GJS, GNOME Shell 45–50 UI modules (`St`, `Clutter`, `PanelMenu`, `PopupMenu`, `Meta`, `Shell`, `SystemActions`), GTK4/libadwaita for `prefs.js`, GSettings/`Gio.Settings`.

## Global Constraints

- Extension UUID stays `macos-top-panel@local.dev`; `shell-version` stays `["50"]` — unchanged from the current `metadata.json`, matching what's actually been validated on this machine.
- No subagent may run `gnome-extensions enable`/`disable`, `gsettings`/`dconf` commands touching `org.gnome.shell` keys, or launch `gnome-shell` itself. Reading this extension's own two schemas via `gio settings --schemadir=schemas ...` is safe (private namespace) and may be used for verification.
- `kiwi-menu/` and `global-menu-for-gnome/` (the two imported repos at the project root) are the **source of truth** for the vendored code — read from them, don't retype from memory. They are deleted only in the final task, after everything that needs to read from them is done.
- Kiwi Menu's `src/`, `app/`, `icons/`, `po/`, `translating/`, `prefs.css` all assume they live directly under the extension root (`this.path`/`this._extensionPath` + `'src'`/`'app'`/`'icons'`, no intermediate folder) — preserve that exact relative layout; do not nest them under `lib/`.
- `global-menu-for-gnome/menuManager.js` has zero filesystem/path dependencies (verified: only imports `gi://*` and `resource://*` modules) — it can move into `lib/menuManager.js` unmodified.
- Dropped feature: Global Menu's own "System Menu" button (`global-menu-for-gnome/systemMenu.js`, the `SystemMenuButton` class and its `show-logo-menu`/`logo-*`/`hide-overview-button`/`show-app-grid`/`show-software-center`/`show-system-monitor`/`show-terminal`/`show-extensions-app`/`show-force-quit`/`show-power-options`/`show-lock-screen`/`show-log-out`/`system-menu-custom-items` settings). Kiwi Menu's own button already covers power options, force quit, and (via its `activity-menu-visibility` setting) Activities-button visibility — keeping both would be two overlapping "system menu" buttons. This file is never vendored.
- Dropped feature: this repo's existing `lib/appNameIndicator.js` (`AppNameButton`, shows the focused app's name as a standalone panel label). Global Menu's `MenuManager` already shows the focused app as the first ("App") dropdown in the bar — keeping `AppNameButton` too would show the app name twice. `extension.js` stops importing/constructing it; the file is deleted as dead code.
- `gettext-domain` stays `"kiwimenu@kemma"` (hardcoded already in `kiwi-menu/app/aboutWindow.js` and `kiwi-menu/app/forceQuitWindow.js` via `Gettext.bindtextdomain('kiwimenu@kemma', ...)` — not worth changing, and translations weren't wired up/compiled before this merge either, so this is not a regression).
- Pure-logic test suites in `tests/*.test.js` (`panelState`, `clockFormat`, `batteryData`, `wifiData`) are untouched by this plan and must still pass at the end — they test files this plan doesn't modify.

---

## Task 1: Vendor Kiwi Menu's runtime tree and Global Menu's MenuManager; delete dead stub files

**Files:**
- Create: `src/` (copied from `kiwi-menu/src/`)
- Create: `app/` (copied from `kiwi-menu/app/`)
- Create: `icons/` (copied from `kiwi-menu/icons/`)
- Create: `po/` (copied from `kiwi-menu/po/`)
- Create: `translating/` (copied from `kiwi-menu/translating/`)
- Create: `prefs.css` (copied from `kiwi-menu/prefs.css`)
- Create: `lib/menuManager.js` (copied from `global-menu-for-gnome/menuManager.js`)
- Delete: `lib/systemMenu.js`
- Delete: `lib/staticMenuBar.js`
- Delete: `lib/appNameIndicator.js`

**Interfaces:**
- Produces: `src/kiwimenu.js` exporting `KiwiMenu` (GObject class, constructor `(settings, extensionPath, extension)`); `src/hideQSbuttons.js` exporting `QuickSettingsActionsController` (constructor `(settings)`); `src/userSwitcher.js` exporting `UserSwitcherController` (constructor `(extension)`); `lib/menuManager.js` exporting `MenuManager` (constructor `(uuid, settings)`, methods `updateMenuForWindow(window)`, `clear()`, `destroy()`). All four are consumed by Task 3's `extension.js`.

- [ ] **Step 1: Copy Kiwi Menu's runtime tree into the repo root, unmodified**

```bash
cd /home/chris/codingprojects/panel
cp -r kiwi-menu/src ./src
cp -r kiwi-menu/app ./app
cp -r kiwi-menu/icons ./icons
cp -r kiwi-menu/po ./po
cp -r kiwi-menu/translating ./translating
cp kiwi-menu/prefs.css ./prefs.css
```

Expected: `ls src app icons po translating prefs.css` all exist at the repo root now. Nothing here needs editing — `src/kiwimenu.js` looks up `this._extensionPath` + `['src', 'icons.json']` etc., and `this._extensionPath` will be this repo's root once `extension.js` passes `this.path` to it in Task 3, which is exactly where `src/` now lives.

- [ ] **Step 2: Copy Global Menu's `menuManager.js` into `lib/`, unmodified**

```bash
cp global-menu-for-gnome/menuManager.js lib/menuManager.js
```

Expected: `lib/menuManager.js` exists, byte-identical to `global-menu-for-gnome/menuManager.js`.

- [ ] **Step 3: Delete the dead stub files this merge replaces**

```bash
rm lib/systemMenu.js lib/staticMenuBar.js lib/appNameIndicator.js
```

Expected: those three files no longer exist under `lib/`. (They are not referenced by anything yet at this point in the plan — `extension.js` still imports them until Task 3 rewrites it, so don't run this repo's extension yet; that's fine, nothing runs it until the human's manual walkthrough in Task 5.)

- [ ] **Step 4: Verify no JS syntax errors in the newly vendored files**

```bash
for f in src/*.js app/*.js lib/menuManager.js; do
    echo "=== $f ==="
    gjs -m "$f" 2>&1 | head -3
done
```

Expected: every file fails only with a `resource://` resolution error (for files importing Shell UI modules) or exits cleanly (for files with no such import) — never a JS syntax error.

- [ ] **Step 5: Commit**

```bash
git add src app icons po translating prefs.css lib/menuManager.js
git add -u lib/systemMenu.js lib/staticMenuBar.js lib/appNameIndicator.js
git commit -m "Vendor Kiwi Menu runtime tree and Global Menu's menuManager.js; drop dead stub files"
```

---

## Task 2: Merged GSettings schemas

**Files:**
- Create: `schemas/org.gnome.shell.extensions.kiwimenu.gschema.xml`
- Create: `schemas/org.gnome.shell.extensions.globalmenu.gschema.xml`

**Interfaces:**
- Produces: schema `org.gnome.shell.extensions.kiwimenu` with keys `icon` (i), `activity-menu-visibility` (b), `hide-lock-button`/`hide-power-button`/`hide-settings-button` (b), `app-store-command` (s), `custom-menu-enabled`/`custom-menu-label`/`custom-menu-command`/`custom-menu-icon`/`custom-menu-shortcut` (s/s/s/s/as), `macos-accelerators` (b), `force-quit-shortcut` (as), `prefs-default-width`/`prefs-default-height` (i) — all consumed by `src/kiwimenu.js`, `src/hideQSbuttons.js`, Task 3's `extension.js`, and Task 4's `prefs.js`. Schema `org.gnome.shell.extensions.globalmenu` with keys `show-indicator` (b), `menu-app-enabled`/`menu-file-enabled`/`menu-edit-enabled`/`menu-view-enabled`/`menu-go-enabled`/`menu-window-enabled`/`menu-help-enabled` (b), `custom-menus` (s), `desktop-app-name` (s) — consumed by `lib/menuManager.js`, Task 3's `extension.js`, and Task 4's `prefs.js`.

- [ ] **Step 1: Copy Kiwi Menu's schema verbatim — it has no dropped keys**

```bash
mkdir -p schemas
cp kiwi-menu/schemas/org.gnome.shell.extensions.kiwimenu.gschema.xml schemas/
```

- [ ] **Step 2: Write the trimmed Global Menu schema, with the System-Menu-button-only keys removed**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.gnome.shell.extensions.globalmenu" path="/org/gnome/shell/extensions/globalmenu/">
    <key name="show-indicator" type="b">
      <default>true</default>
      <summary>Show Global Menu</summary>
      <description>Master toggle for the whole global menu bar.</description>
    </key>

    <key name="menu-app-enabled" type="b"><default>true</default><summary>Show App menu</summary></key>
    <key name="menu-file-enabled" type="b"><default>true</default><summary>Show File menu</summary></key>
    <key name="menu-edit-enabled" type="b"><default>true</default><summary>Show Edit menu</summary></key>
    <key name="menu-view-enabled" type="b"><default>true</default><summary>Show View menu</summary></key>
    <key name="menu-go-enabled" type="b"><default>true</default><summary>Show Go menu</summary></key>
    <key name="menu-window-enabled" type="b"><default>true</default><summary>Show Window menu</summary></key>
    <key name="menu-help-enabled" type="b"><default>true</default><summary>Show Help menu</summary></key>

    <key name="custom-menus" type="s">
      <default>"[]"</default>
      <summary>JSON list of custom menu sections</summary>
      <description>Each entry: {label, enabled, items: [{label, kind: "command"|"shortcut", value}]}. Supports any number of independent custom top-level menus.</description>
    </key>

    <key name="desktop-app-name" type="s">
      <default>"Nautilus"</default>
      <summary>Name shown for the file manager / desktop placeholder in the App menu</summary>
      <description>Used for the App menu label and File menu items (e.g. "About X", "Open X", "New X Window") when no other app is focused.</description>
    </key>
  </schema>
</schemalist>
```

Save this as `schemas/org.gnome.shell.extensions.globalmenu.gschema.xml`.

- [ ] **Step 3: Gitignore the compiled schema artifact**

Check if `.gitignore` exists at the repo root:

```bash
cat .gitignore 2>/dev/null || echo "(no .gitignore yet)"
```

If it doesn't contain `schemas/gschemas.compiled`, create/append it:

```bash
echo "schemas/gschemas.compiled" >> .gitignore
```

- [ ] **Step 4: Compile and verify both schemas, read-only**

```bash
glib-compile-schemas --strict schemas/
gio settings --schemadir=schemas list-keys org.gnome.shell.extensions.kiwimenu
gio settings --schemadir=schemas list-keys org.gnome.shell.extensions.globalmenu
gio settings --schemadir=schemas get org.gnome.shell.extensions.globalmenu desktop-app-name
```

Expected: `glib-compile-schemas` produces no output (success); `list-keys` for `kiwimenu` prints all 13 key names matching the Interfaces block above; `list-keys` for `globalmenu` prints exactly the 10 key names above (no `show-logo-menu`, no `logo-*`, no `hide-overview-button`, no System-Menu-item keys); `get desktop-app-name` prints `'Nautilus'`. This only reads this extension's own private settings namespace via `--schemadir` — it does not touch `org.gnome.shell`'s real settings.

- [ ] **Step 5: Commit**

```bash
git add schemas/org.gnome.shell.extensions.kiwimenu.gschema.xml schemas/org.gnome.shell.extensions.globalmenu.gschema.xml .gitignore
git commit -m "Add merged GSettings schemas for Kiwi Menu and Global Menu"
```

---

## Task 3: Rewrite extension.js, metadata.json, and stylesheet.css

**Files:**
- Modify: `extension.js`
- Modify: `metadata.json`
- Modify: `stylesheet.css`

**Interfaces:**
- Consumes: `KiwiMenu` from `./src/kiwimenu.js`, `QuickSettingsActionsController` from `./src/hideQSbuttons.js`, `UserSwitcherController` from `./src/userSwitcher.js` (all Task 1), `MenuManager` from `./lib/menuManager.js` (Task 1), the two schema IDs from Task 2, `snapshotBox`/`clearBox`/`restoreBox` from `./lib/panelState.js` (pre-existing, unchanged), `ClockWidget`/`BatteryIndicator`/`WifiIndicator` from `./lib/*.js` (pre-existing, unchanged).
- Produces: nothing new for later tasks — this is the extension's entry point.

- [ ] **Step 1: Read the current `extension.js` to confirm its exact current state before replacing it**

The file currently constructs `AppleMenuButton`, `AppNameButton`, `StaticMenuBar` — all being removed by this task.

- [ ] **Step 2: Replace `extension.js` with the merged wiring**

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';
import {BatteryIndicator} from './lib/batteryIndicator.js';
import {WifiIndicator} from './lib/wifiIndicator.js';
import {MenuManager} from './lib/menuManager.js';
import {KiwiMenu} from './src/kiwimenu.js';
import {QuickSettingsActionsController} from './src/hideQSbuttons.js';
import {UserSwitcherController} from './src/userSwitcher.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        try {
            this._kiwiSettings = this.getSettings('org.gnome.shell.extensions.kiwimenu');
            this._globalMenuSettings = this.getSettings('org.gnome.shell.extensions.globalmenu');

            this._boxSnapshots = {
                left: snapshotBox(Main.panel._leftBox),
                center: snapshotBox(Main.panel._centerBox),
                right: snapshotBox(Main.panel._rightBox),
            };

            clearBox(Main.panel._leftBox);
            clearBox(Main.panel._centerBox);
            clearBox(Main.panel._rightBox);

            this._kiwiMenu = new KiwiMenu(this._kiwiSettings, this.path, this);
            Main.panel.addToStatusArea('KiwiMenuButton', this._kiwiMenu, 0, 'left');

            this._userSwitcherController = new UserSwitcherController(this);
            this._quickSettingsController = new QuickSettingsActionsController(this._kiwiSettings);

            this._menuManager = new MenuManager(this.uuid, this._globalMenuSettings);
            this._globalMenuChangedId = this._globalMenuSettings.connect('changed', () => {
                this._syncGlobalMenuVisibility();
            });
            global.display.connectObject('notify::focus-window', () => {
                this._syncGlobalMenuVisibility();
            }, this);
            this._syncGlobalMenuVisibility();

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
        } catch (e) {
            logError(e, '[macos-top-panel] enable() failed, rolling back');
            this.disable();
            throw e;
        }
    }

    _syncGlobalMenuVisibility() {
        if (!this._menuManager)
            return;

        if (this._globalMenuSettings.get_boolean('show-indicator')) {
            let activeWindow = global.display.get_focus_window();
            this._menuManager.updateMenuForWindow(activeWindow);
        } else {
            this._menuManager.clear();
        }
    }

    disable() {
        if (!this._boxSnapshots)
            return;

        global.display.disconnectObject(this);

        if (this._globalMenuChangedId) {
            this._globalMenuSettings.disconnect(this._globalMenuChangedId);
            this._globalMenuChangedId = null;
        }

        this._clockWidget?.destroy();
        this._clockWidget = null;

        // Do NOT destroy quickSettings.container — it's the real stock object,
        // restoreBox() below puts it back where it came from.

        if (this._wifiIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._wifiIndicator.menu);
        this._wifiIndicator?.destroy();
        this._wifiIndicator = null;

        if (this._batteryIndicator?.menu)
            Main.panel.menuManager.removeMenu(this._batteryIndicator.menu);
        this._batteryIndicator?.destroy();
        this._batteryIndicator = null;

        this._menuManager?.destroy();
        this._menuManager = null;

        this._quickSettingsController?.destroy();
        this._quickSettingsController = null;

        this._userSwitcherController?.destroy();
        this._userSwitcherController = null;

        this._kiwiMenu?.destroy();
        this._kiwiMenu = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;

        this._kiwiSettings = null;
        this._globalMenuSettings = null;
    }
}
```

- [ ] **Step 3: Update `metadata.json`**

Read the current file first — it's:
```json
{
    "uuid": "macos-top-panel@local.dev",
    "name": "macOS-style Top Panel",
    "description": "Replaces the GNOME top bar with a macOS-style menu bar. Personal use only.",
    "shell-version": ["50"]
}
```

Replace it with:
```json
{
    "uuid": "macos-top-panel@local.dev",
    "name": "macOS-style Top Panel",
    "description": "Replaces the GNOME top bar with a macOS-style menu bar: Kiwi Menu's Apple-style system menu on the left, a live per-app File/Edit/View/Go/Window/Help bar next to it, plus battery, Wi-Fi, Quick Settings, and clock on the right. Personal use only.",
    "shell-version": ["50"],
    "gettext-domain": "kiwimenu@kemma",
    "settings-schema": "org.gnome.shell.extensions.kiwimenu",
    "version-name": "1.0.0"
}
```

- [ ] **Step 4: Trim `stylesheet.css` down to only the rules still used, then append Kiwi Menu's stylesheet**

Read the current file first — it's:
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

`.macos-apple-glyph`, `.macos-app-name`, `.macos-static-menu-bar`, and `.macos-static-menu-label` all styled the three files deleted in Task 1 — remove them. `.macos-clock` and `.macos-clock-date`/`.macos-clock-time` still style `lib/clockWidget.js`, unchanged — keep them. Replace the file with:

```css
/* macOS-style top panel */

.macos-clock {
    spacing: 6px;
    padding: 0 10px;
}

.macos-clock-date,
.macos-clock-time {
    font-size: 13px;
}
```

Then append Kiwi Menu's stylesheet, which styles everything under `src/`:

```bash
cat kiwi-menu/stylesheet.css >> stylesheet.css
```

- [ ] **Step 5: Verify no syntax errors**

```bash
gjs -m extension.js
```
Expected: fails only with a `resource://` resolution error, not a JS syntax error.

- [ ] **Step 6: Verify the pre-existing pure-logic test suites still pass (this task didn't touch them, confirming nothing else broke)**

```bash
for f in tests/*.test.js; do echo "=== $f ==="; gjs -m "$f" || exit 1; done
echo "ALL SUITES EXIT: $?"
```
Expected: all four suites pass, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add extension.js metadata.json stylesheet.css
git commit -m "Wire Kiwi Menu and Global Menu's MenuManager into extension.js"
```

---

## Task 4: Merged preferences window

**Files:**
- Create: `prefs.js`

**Interfaces:**
- Consumes: `this.getSettings('org.gnome.shell.extensions.kiwimenu')` and `this.getSettings('org.gnome.shell.extensions.globalmenu')` (Task 2 schemas); `this.path` (extension root, same layout Task 1 vendored `src/`, `app/`, `icons/`, `prefs.css` into).
- Produces: `MacosTopPanelPreferences` (default export, `ExtensionPreferences` subclass) — nothing else depends on this file.

- [ ] **Step 1: Extract Kiwi Menu's icon-loader helper and `OptionsPage` class verbatim**

```bash
cd /home/chris/codingprojects/panel
sed -n '15,32p' kiwi-menu/prefs.js > /tmp/kiwi-options-page.js
echo "" >> /tmp/kiwi-options-page.js
sed -n '34,698p' kiwi-menu/prefs.js >> /tmp/kiwi-options-page.js
```

Expected: `/tmp/kiwi-options-page.js` now holds the `loadIconsMetadata(sourcePath)` function and the full `const OptionsPage = GObject.registerClass(...)` block (ending in the `);` that closes `registerClass`). Skim it (`cat /tmp/kiwi-options-page.js | head -5` and `tail -5`) to confirm it starts with `function loadIconsMetadata` and ends with `);`.

- [ ] **Step 2: Extract Kiwi Menu's About/legal page methods verbatim**

```bash
sed -n '724,1017p' kiwi-menu/prefs.js > /tmp/kiwi-about-methods.js
tail -5 /tmp/kiwi-about-methods.js
```

Expected: this spans `_ensureVersionCss` through `_launchUri` — the last two methods in the `KiwiMenuPreferences` class before its closing `}`. Confirm the tail output shows the end of `_launchUri(window, url) { ... }` and NOT the class's own closing brace or `export default` line (if it does, trim the range down by adjusting the end line number and re-run).

- [ ] **Step 3: Extract Global Menu's `_buildMenusPage` and `_buildCustomMenuPage` methods verbatim**

```bash
sed -n '439,461p' global-menu-for-gnome/prefs.js > /tmp/globalmenu-menus-page.js
sed -n '469,608p' global-menu-for-gnome/prefs.js > /tmp/globalmenu-custom-page.js
head -1 /tmp/globalmenu-menus-page.js
tail -1 /tmp/globalmenu-menus-page.js
head -1 /tmp/globalmenu-custom-page.js
tail -1 /tmp/globalmenu-custom-page.js
```

Expected: `/tmp/globalmenu-menus-page.js` starts with `    _buildMenusPage(settings) {` and ends with `    }`; `/tmp/globalmenu-custom-page.js` starts with `    _buildCustomMenuPage(settings) {` and ends with `    }`.

- [ ] **Step 4: Confirm neither extracted Global Menu method references `this`**

```bash
grep -n "this\." /tmp/globalmenu-menus-page.js /tmp/globalmenu-custom-page.js
```

Expected: no output (both methods only close over their `settings` parameter and local variables). If this prints any matches, read the matching line in context in `global-menu-for-gnome/prefs.js` and resolve the `this.` reference before continuing (e.g. `this.metadata` would need `this` bound to the outer class — pass it as an extra parameter instead).

- [ ] **Step 5: Assemble `prefs.js`**

Convert the two Global Menu methods from class methods into standalone functions by changing their signature lines from `    _buildMenusPage(settings) {` to `function buildGlobalMenuMenusPage(settings) {` and `    _buildCustomMenuPage(settings) {` to `function buildGlobalMenuCustomMenuPage(settings) {` (keep everything else in each file identical — body, closing brace).

Write the following as `prefs.js`, splicing in the four extracted files (marked below) exactly where indicated:

```js
/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * prefs.js - Preferences window for the merged macOS-style Top Panel extension.
 * Combines Kiwi Menu's Options/About pages with Global Menu's Menus/Custom Menus pages.
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// ===== BEGIN: verbatim content of /tmp/kiwi-options-page.js =====
// (loadIconsMetadata() + the OptionsPage GObject class, unmodified)
// ===== END =====

function buildGlobalMenuGeneralPage(settings) {
    const page = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' });

    const mainGroup = new Adw.PreferencesGroup({ title: 'Global Menu' });
    page.add(mainGroup);

    const showRow = new Adw.SwitchRow({ title: 'Show Global Menu', subtitle: 'Master toggle for the whole menu bar' });
    mainGroup.add(showRow);
    settings.bind('show-indicator', showRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    const desktopNameRow = new Adw.EntryRow({ title: 'File Manager / Desktop Name' });
    desktopNameRow.set_text(settings.get_string('desktop-app-name'));
    desktopNameRow.connect('notify::text', () => settings.set_string('desktop-app-name', desktopNameRow.get_text() || 'Nautilus'));
    mainGroup.add(desktopNameRow);

    return page;
}

// ===== BEGIN: verbatim content of /tmp/globalmenu-menus-page.js, with the =====
// ===== signature line changed to `function buildGlobalMenuMenusPage(settings) {` =====
// ===== END =====

// ===== BEGIN: verbatim content of /tmp/globalmenu-custom-page.js, with the =====
// ===== signature line changed to `function buildGlobalMenuCustomMenuPage(settings) {` =====
// ===== END =====

export default class MacosTopPanelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const kiwiSettings = this.getSettings('org.gnome.shell.extensions.kiwimenu');
        const globalMenuSettings = this.getSettings('org.gnome.shell.extensions.globalmenu');

        window._settings = kiwiSettings;
        window.title = this.metadata.name ?? 'macOS-style Top Panel';
        window.set_default_size(720, 780);
        window.set_size_request(360, 500);
        window.set_search_enabled(true);

        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        const iconsPath = GLib.build_filenamev([this.path, 'src']);
        iconTheme.add_search_path(iconsPath);

        this._ensureVersionCss(window);

        const _ = this.gettext.bind(this);
        const aboutPage = this._createAboutPage(window, _);
        const optionsPage = new OptionsPage(kiwiSettings, this.path, _);

        window.add(aboutPage);
        window.add(optionsPage);
        window.add(buildGlobalMenuMenusPage(globalMenuSettings));
        window.add(buildGlobalMenuGeneralPage(globalMenuSettings));
        window.add(buildGlobalMenuCustomMenuPage(globalMenuSettings));
    }

    // ===== BEGIN: verbatim content of /tmp/kiwi-about-methods.js =====
    // (_ensureVersionCss through _launchUri, unmodified)
    // ===== END =====
}
```

(The `window._settings = kiwiSettings;` line matches what Kiwi Menu's own original `prefs.js` did — some of the spliced-in About-page code may reference `window._settings`; keeping it pointed at `kiwiSettings` preserves that behavior exactly.)

- [ ] **Step 6: Verify no syntax errors**

```bash
gjs -m prefs.js
```
Expected: fails only with a `resource://` resolution error (for the `ExtensionPreferences` import), not a JS syntax error.

- [ ] **Step 7: Clean up temp files**

```bash
rm -f /tmp/kiwi-options-page.js /tmp/kiwi-about-methods.js /tmp/globalmenu-menus-page.js /tmp/globalmenu-custom-page.js
```

- [ ] **Step 8: Commit**

```bash
git add prefs.js
git commit -m "Add merged preferences window (Kiwi Menu Options/About + Global Menu Menus/Custom Menus)"
```

---

## Task 5: Final verification and cleanup

**Files:**
- Delete: `kiwi-menu/` (fully vendored by Task 1/4, no longer needed)
- Delete: `global-menu-for-gnome/` (fully vendored by Task 1/2/4, no longer needed)

**Interfaces:**
- None new — this task is verification and cleanup only.

- [ ] **Step 1: Static syntax check every file that touches Shell/GTK resources**

```bash
for f in extension.js prefs.js lib/*.js src/*.js app/*.js; do
    echo "=== $f ==="
    gjs -m "$f" 2>&1 | head -3
done
```
Expected: every file fails only with a `resource://` resolution error, or exits cleanly — never a JS syntax error.

- [ ] **Step 2: Run every pre-existing automated test suite**

```bash
for f in tests/*.test.js; do echo "=== $f ==="; gjs -m "$f" || exit 1; done
echo "All automated tests passed."
```
Expected: all four suites (`panelState`, `clockFormat`, `batteryData`, `wifiData`) print their `PASS` lines and exit code 0.

- [ ] **Step 3: Re-verify both schemas compile and expose exactly the expected keys**

```bash
glib-compile-schemas --strict schemas/
gio settings --schemadir=schemas list-keys org.gnome.shell.extensions.kiwimenu | sort
gio settings --schemadir=schemas list-keys org.gnome.shell.extensions.globalmenu | sort
```
Expected: no compile errors; the `globalmenu` key list has exactly 10 entries (no `show-logo-menu`, `logo-*`, `hide-overview-button`, or any System-Menu-item key).

- [ ] **Step 4: Confirm nothing outside `kiwi-menu/` and `global-menu-for-gnome/` still references those two directories**

```bash
grep -rn "kiwi-menu/\|global-menu-for-gnome/" --include="*.js" --include="*.json" --include="*.css" --include="*.xml" -- extension.js metadata.json stylesheet.css prefs.js schemas/ lib/ src/ app/ 2>/dev/null
```
Expected: no output — every file this repo actually loads is self-contained now.

- [ ] **Step 5: Delete the fully-vendored source repos**

```bash
rm -rf kiwi-menu global-menu-for-gnome
git status
```
Expected: `git status` shows `kiwi-menu/` and `global-menu-for-gnome/` no longer listed (they were untracked, so this is a plain deletion, not a `git rm`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Remove fully-vendored kiwi-menu and global-menu-for-gnome source directories"
```

- [ ] **Step 7: Full manual walkthrough (deferred to human — not a subagent step)**

Using the nested-session-free workflow already established for this project (log out/in, or `gnome-extensions enable/disable macos-top-panel@local.dev` in your real session):

1. Confirm the leftmost panel button is Kiwi Menu's icon (not a generic `start-here-symbolic` glyph), and its dropdown has the expected Kiwi Menu items (App Store, Recent Items, Force Quit, power options, etc.).
2. Confirm the File/Edit/View/Go/Window/Help bar appears immediately to the right of the Kiwi Menu icon, and the first ("App") dropdown shows the name of whatever app is currently focused, updating live as you switch windows.
3. Confirm there is only ONE leftmost system-style icon — no second "System Menu" button duplicating Kiwi Menu's.
4. Confirm no separate app-name label appears anywhere — the focused app's name only shows inside the "App" dropdown.
5. Confirm battery, Wi-Fi, Quick Settings, and the clock still appear on the right exactly as before this merge.
6. Run `gnome-extensions prefs macos-top-panel@local.dev` — confirm the Preferences window opens with 5 pages: About, Options (Kiwi Menu), Menus, General, Custom Menus (Global Menu) — and that toggling switches on each page has a live effect on the panel without needing to re-enable the extension.
7. Toggle the extension off and on a few times — confirm the bar restores to the exact stock GNOME panel each time, with nothing left over.

- [ ] **Step 8: Commit any fixes found during the walkthrough**

If Step 7 finds a real bug, fix it and commit:
```bash
git add -A
git commit -m "Fix issues found during menu-merge walkthrough"
```
If nothing needs fixing, this task ends at Step 6 with no additional commit.
