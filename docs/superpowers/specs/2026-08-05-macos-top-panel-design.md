# macOS-style Top Panel — GNOME Shell Extension Design

Date: 2026-08-05
Target platform: GNOME Shell 50.x, Wayland, Ubuntu 26.04
Status: Approved for planning

## Goal

Replace GNOME Shell's stock top bar with a bar styled after macOS's menu bar, for personal use (not intended for distribution — uses an Apple logo glyph, which is a trademark, so this stays local-only).

## Layout

**Left box, left to right:**
1. Apple-glyph menu button
2. Focused app's name (bold)
3. Static labels: `File  Edit  View  Window  Help`

**Right box, left to right:**
1. Battery icon + percentage
2. Wi-Fi icon
3. Control Center icon
4. Date
5. Time

Center box is empty (macOS convention).

## Scope decisions (from brainstorming)

- **File/Edit/View/Window/Help**: static, non-interactive labels. They do not reflect the focused app's real menus — modern Linux apps (GTK4, Electron) don't expose a global-menu protocol GNOME could read the way macOS apps do, so building "real" per-app menus was ruled out as infeasible for most apps.
- **Apple logo**: real Apple glyph, clickable, opens a system menu (About This Computer, Settings, Lock Screen, Suspend, Restart, Shut Down, Log Out).
- **App name button**: clickable, opens a generic Quit / Hide / About menu that works via window management, not per-app APIs (no real per-app About box exists to hook into).
- **Battery & Wi-Fi**: fully custom widgets reading live data directly from UPower and NetworkManager (not reusing GNOME's Quick Settings indicator UI/popups). Each has its own click-to-open, status-only dropdown — no settings shortcuts on battery, no network picker on Wi-Fi (just current SSID/strength + an on/off toggle). This was an explicit choice over reusing GNOME's merged Quick Settings popup, trading more implementation work for independent, app-specific-feeling dropdowns.
- **Control Center icon**: the one exception to "fully custom" — this reuses the actual stock GNOME Quick Settings button object, relocated into the custom bar, since that button's entire job is to be the control center.
- **Date/Time**: custom clock widget (own GLib timer), rendered as two label segments, macOS-style formatting (e.g. `Tue Aug 5   10:42 PM`). Static, no calendar dropdown.
- **Activities button & input-source/keyboard-layout indicator**: hidden, since neither is part of the target macOS layout. (Noted as reversible if the input-source switcher turns out to be missed in daily use.)

## Architecture

A single GNOME Shell extension using the modern ESM `Extension` class (`resource:///org/gnome/shell/extensions/extension.js`). On `enable()`, it modifies `Main.panel` in place rather than building a second overlay bar:

1. Snapshot the stock panel's box children and visibility state, so `disable()` can fully restore it.
2. Hide the stock Activities button, input-source indicator, and stock left/center box contents (clock).
3. Reparent the real stock Quick Settings button out of its default position into the custom right box (Control Center slot).
4. Build and insert custom left-box actors: Apple menu button, app-name button, static menu labels.
5. Build and insert custom right-box actors: battery widget, Wi-Fi widget, (reparented) Control Center button, date/time widget.

On `disable()`: destroy all custom actors, disconnect all signals/timeouts, restore the stock panel's original children, order, and visibility exactly as snapshotted. `enable()`/`disable()` must be idempotent and safe to call repeatedly (e.g. across extension toggle, not full Shell restart — Wayland has no shell-restart-in-place).

### Components

- **AppleMenuButton** (`PanelMenu.Button`): static Apple glyph icon; menu built from GNOME Shell's own `SystemActions` helper class (a pure action-dispatcher, not a competing UI/indicator) for Lock/Suspend/Restart/Shut Down/Log Out, plus a launcher for `gnome-control-center` (Settings) and a simple About dialog (OS name/version/hostname/kernel via `GLib`/`os-release`).
- **AppNameButton** (`PanelMenu.Button`): label bound to `Shell.WindowTracker`'s `notify::focus-app` signal. Menu: Quit (`Meta.Window.delete()` on the focused window), Hide (`Meta.Window.minimize()`), About (notification-style popup with app name/icon — best-effort, not a real per-app About box).
- **Static menu labels**: plain `St.Label` actors, `File  Edit  View  Window  Help`, no signal handlers.
- **BatteryIndicator**: custom `PanelMenu.Button`. Data source: `org.freedesktop.UPower`'s DisplayDevice via `Gio.DBusProxy` (or `UPowerGlib` if simpler in practice). Shows icon + percentage; auto-hides on machines with no battery. Dropdown: percentage, charging/discharging state, time-to-empty/full — read-only.
- **WifiIndicator**: custom `PanelMenu.Button`. Data source: NetworkManager via the `NM` GObject introspection library (the same library GNOME Shell's own network indicator uses internally). Shows current SSID + signal-strength icon. Dropdown: SSID, signal strength, Wi-Fi on/off toggle. No network scanning/picker/saved-connection management.
- **Control Center**: the actual `Main.panel.statusArea.quickSettings` actor, reparented into the custom right box. No new code beyond relocating it.
- **ClockWidget**: custom widget, `GLib.timeout_add_seconds`-driven, rendering two label segments (date, time) from one `GLib.DateTime`, macOS-style formatting.

## Error handling

- UPower or NetworkManager D-Bus service unavailable/proxy failure → the corresponding indicator hides itself rather than throwing.
- No battery present → BatteryIndicator hides itself.
- Focused window has no associated app (desktop, override-redirect windows) → AppNameButton blanks its label rather than erroring.
- All signal connections and timeouts are tracked and disconnected in `disable()`.

## Testing

- Primary iteration loop: nested test session (`dbus-run-session -- gnome-shell --nested --wayland`) to develop and click through without risking the real session.
- Watch `journalctl --user -f` for JS exceptions during development (Looking Glass `lg` as a secondary inspection tool).
- Once stable in the nested session, install into the real session via `~/.local/share/gnome-shell/extensions/<uuid>/` and verify enable/disable toggling repeatedly (checks restoration logic), plus behavior across: no battery present, Wi-Fi off, no focused window, focused window with no app.
