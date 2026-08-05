# Panel Customization & Visual Polish — Design

Date: 2026-08-06
Target platform: GNOME Shell 50.x, Wayland, Ubuntu 26.04 (same as the base extension)
Status: Approved for planning
Builds on: `docs/superpowers/specs/2026-08-05-macos-top-panel-design.md`

## Goal

Fix the visual bugs in the first version of the macOS-style top panel (duplicate battery/wifi icons, inconsistent alignment), apply the user's SF Pro Display font family, and add a Preferences window covering per-indicator visibility/size and three panel background modes — including a dynamic mode that samples and matches the color of whatever window touches the top of the screen, macOS-style.

## Scope decisions (from brainstorming)

- **Free-form pixel positioning was considered and explicitly dropped.** The user initially asked for exact x/y placement of every indicator, but on reflection only wants correct alignment plus adjustable size — not drag-anywhere placement. This keeps the panel on GNOME's normal left-to-right box layout; no custom fixed-layout container is needed.
- **Duplicate icon bug**: caused by relocating GNOME's real Quick Settings button (which bundles its own wifi/battery/etc. glyphs) right next to this extension's own separate battery/wifi indicators. Fixed by replacing the relocated real button with a small custom "Control Center" button showing one simple icon, whose only job is to open the real Quick Settings popup on click.
- **Font**: the user's font file at `~/Downloads/OPENSOURCEFREEFONTSDOTCOM/FREEFONTONEREGULAR.OTF` internally identifies itself as "SF Pro Display" — the real macOS system font — and sibling files in the same folder cover Bold, Medium, and italic weights. The extension installs the whole family system-wide (`~/.local/share/fonts/`) rather than referencing one file in place, so weight variation (bold app name vs. regular menu text) works and the font becomes available system-wide, not just to this panel.
- **Per-indicator control**: every panel element gets a visibility toggle and a size slider in Preferences. Reordering is out of scope — the left-to-right order established in the base extension stays fixed.
- **Background — three modes**: Static Color, Transparent, and Blends with Window. Blend mode isn't a fully separate visual identity: when no window touches the top of the screen, it falls back to the user's chosen static color/transparency; it only overrides to a sampled color while a window is touching.
- **"Touching the top edge"** means maximized OR snap-tiled-to-top windows on the current workspace — not full-screen-only. This matches how macOS's menu bar reacts to any window reaching the screen's top edge.
- **Color sampling mechanism**: confirmed via GNOME Shell 50.1's actual installed source (`ui/screenshot.js`) that `Shell.Screenshot.pick_color(x, y)` is a real, promisified async API — the same eyedropper primitive GNOME's own screenshot tool's color picker uses. This is what makes "sample the color under the panel" feasible without hand-rolling pixel-buffer capture.

## Components

### 1. Bug fixes to the existing base extension

- **`lib/controlCenterButton.js`** (new): replaces Task 10's "relocate the real Quick Settings button" approach. A small custom `PanelMenu.Button`-alike (or simpler: a plain clickable `St.Icon` wrapped the same way other custom indicators are) showing one static icon (a toggles/sliders glyph, e.g. `view-list-bullet-symbolic` or similar generic icon — exact icon name to be confirmed during planning). Click handler: `Main.panel.statusArea.quickSettings.menu.open()`. The real Quick Settings button itself is left untouched and hidden in its original stock position (never shown, but never destroyed either — same non-destructive-of-shared-state principle as before).
- **`extension.js`**: swap the Quick Settings reparenting code for construction of the new `ControlCenterButton`.
- **`stylesheet.css`**: normalize vertical alignment (consistent `y_align: CENTER` already used everywhere, but padding/margins get audited and made consistent) and spacing between all left-box and right-box elements so gaps read as even, matching the reference screenshot's proportions rather than the current cramped/uneven spacing.

### 2. Font installation

- **`lib/fontInstaller.js`** (new, pure-ish logic + `Gio.File` I/O): on `enable()`, checks whether SF Pro Display is already installed (`fc-list` equivalent check, or a marker file) and if not, copies the known font files from the user's Downloads folder into `~/.local/share/fonts/`, then triggers a fontconfig cache refresh (`fc-cache -f`, invoked via `Gio.Subprocess`). Idempotent — safe to run on every `enable()`, does nothing if already installed.
- **`stylesheet.css`**: `font-family: "SF Pro Display";` becomes the base panel font; bold elements (app name) get `font-weight: bold`, which Pango resolves against the installed Bold weight face.
- Source font files are copied from a fixed path under the user's home directory. Since this is personal-use software running on the developer's own machine (not distributed), a hardcoded source path is acceptable — this is explicitly not designed for portability to other users' machines.

### 3. Preferences window (`prefs.js` + GSettings schema)

- **GSettings schema** (`schemas/org.gnome.shell.extensions.macos-top-panel.gschema.xml`, compiled to `schemas/gschemas.compiled`): one boolean + one double (0.5–2.0 scale factor) key per panel element — apple, app-name, static-menu, battery, wifi, control-center, clock (14 keys) — plus `background-mode` (enum: `'color' | 'transparent' | 'blend'`), `background-color` (string, RGBA hex with alpha channel).
- **`prefs.js`**: a modern `ExtensionPreferences` subclass using `fillPreferencesWindow(window)` with libadwaita widgets — an `Adw.PreferencesPage` with two `Adw.PreferencesGroup`s: "Panel Elements" (7 rows, each an `Adw.SwitchRow` paired with a size-scale control) and "Background" (an `Adw.ComboRow` for mode, a color-button row for the static/idle color).
- **`extension.js`**: reads all settings on `enable()`, applies them (visibility, scale via inline `.style` updates on each actor, background mode/color on the panel), and connects to the GSettings `changed` signal so preference edits apply live without re-enabling the extension.

### 4. Dynamic window-color blending

- **`lib/windowColorBlend.js`** (new): when `background-mode` is `'blend'`, this module:
  1. Listens for events that can change what's touching the top of the screen: `global.display`'s `notify::focus-window`, `window-left-monitor`/`window-entered-monitor` are unreliable for resize/move — instead hook `global.window_manager`'s `size-change`/`switch-workspace` signals and each on-screen window's `position-changed`/`size-changed` (via `Meta.Window` signals on windows relevant to the current workspace), debounced (e.g. 150ms via `GLib.timeout_add`) so rapid drags don't trigger a sample storm.
  2. On a triggered check: determine if any window on the current workspace has its top edge at or above the panel's bottom edge and horizontally overlaps the panel (maximized or top-snapped). If yes, pick a horizontal sample point (center of the panel, or center of the overlapping window — center of panel is simpler and sufficient) and call `new Shell.Screenshot().pick_color(x, panelBottomY + 1)`.
  3. Apply the returned color as the panel's background color (converted to a CSS `rgb()`/`rgba()` string, full opacity since blend mode implies "matches a real window," not translucency).
  4. If no window is touching, fall back to the `background-color` setting's static color/transparency (the "idle" look).
- This module is UI-glue (depends on `Shell`, `Meta`, `global`), so — consistent with the rest of this codebase — it isn't unit-testable outside a running Shell; verification is static review plus the human's manual walkthrough.

## Error handling

- Font installer: if the source files aren't found (e.g., the Downloads folder path changed), log and skip — the panel falls back to the system default font rather than throwing and blocking `enable()`.
- Preferences: GSettings schema failing to load (e.g., not compiled) should not crash `enable()` — settings reads fall back to sensible defaults (current hardcoded look) if the schema/settings object can't be obtained.
- Color sampling: `pick_color` failures (e.g., called with out-of-bounds coordinates during a display change) are caught and treated as "no color available this cycle" — the panel keeps its last-known color rather than erroring.

## Testing

- Same split as the base extension: pure-logic pieces (if any emerge, e.g. a color-format conversion helper) get `gjs -m`-testable unit tests; UI-glue (font installer's actual file I/O side effects, prefs.js, window-color blending) gets static code review plus a human interactive walkthrough, per the safety lesson learned on the base extension (no subagent may run `gnome-extensions enable/disable`, touch `gsettings`/`dconf` for the shell's own `enabled-extensions`, or launch `gnome-shell` itself). Running `gnome-extensions prefs <uuid>` to open the Preferences window is a separate, extension-scoped GSettings schema — not the global shell settings that caused the earlier incident — but still opens a real GUI window, so it remains a human verification step, not something a subagent attempts non-interactively.
