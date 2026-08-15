# Control Center Redesign — Design

Date: 2026-08-15

## Goal

Replace the current Control Center behavior — which just relocates and
re-faces GNOME's real, unmodified Quick Settings button — with a fully
custom, macOS-style Control Center popup: a Wi-Fi pill, Bluetooth and
Screen Mirroring circles, a Focus toggle, a media-player card, and a
Display brightness slider, laid out to match the provided reference
screenshot. Every tile must be backed by real system state, not a static
mockup.

## Non-goals

- True backdrop blur/vibrancy behind the popup. GNOME Shell can apply
  blur effects, but blurring live desktop content behind an open popup is
  fragile and heavy for what it buys visually here. The frosted-glass
  look is approximated with translucency and color instead.
- macOS Stage Manager and the second small square tile from the
  screenshot. Neither has a meaningful Linux equivalent; they are
  dropped from the layout rather than kept as non-functional
  placeholders (per explicit decision — a "fully functional" redesign
  should not ship fake buttons).
- Bluetooth device pairing/quick-connect list. The circle is a power
  toggle plus the currently-connected device name; pairing stays in
  `gnome-control-center`.
- Wi-Fi network switching from the Control Center. The pill toggles
  Wi-Fi on/off, same as the existing panel Wi-Fi indicator; picking a
  different network stays out of scope.
- Media seeking/progress bar. Transport is Previous/Play-Pause/Next
  only, matching the reference.
- New GSettings schema/keys for this extension. Every toggle reads and
  writes the same system-level source GNOME's own stock toggles use, so
  there's nothing new to persist.

## Architecture

`lib/controlCenterIcon.js` is removed. In its place:

- **`lib/controlCenterIndicator.js`** — a `PanelMenu.Button` subclass
  following the same pattern as `wifiIndicator.js` / `batteryIndicator.js`
  / `soundIndicator.js`. Owns the popup layout and one controller
  instance per tile (below). The panel face reuses the existing
  `control-center-white.png` icon.
- The popup content is **not** built from `PopupMenu.PopupMenuItem`
  rows. Like GNOME's own Quick Settings menu, raw `St` actors (custom
  pill/circle buttons, the media card, the slider) are composed with
  nested `St.BoxLayout`s and added directly into `this.menu.box`.

`extension.js` changes:
- Replace `new ControlCenterIconController(...)` with
  `new ControlCenterIndicator(...)`, added to `Main.panel._rightBox` in
  the same position currently occupied by the relocated
  `quickSettings.container` (after the sound indicator, before the
  clock).
- Remove the code that shows and relocates `quickSettings.container`.
  The real Quick Settings button stays hidden and untouched, same
  treatment the stock battery/Wi-Fi/sound indicators already get.

### Per-tile files

New files, flat in `lib/`, following the existing `*Data.js` (pure,
unit-tested logic) + `*Controller.js`/`*Indicator.js` (GObject/D-Bus
glue, not unit-tested — consistent with how every existing indicator in
this repo is structured) split:

| File | Responsibility |
|---|---|
| `lib/wifiTileController.js` | NM.Client wiring for the pill. Reuses `parseWifiState` from the existing `wifiData.js` — no new Wi-Fi data logic. |
| `lib/bluetoothController.js` + `lib/bluetoothData.js` (+ `.test.js`) | BlueZ D-Bus wiring / pure parsing of adapter-powered + connected-device state. |
| `lib/screenMirroringController.js` | Thin `Gio.Settings` wrapper. |
| `lib/focusController.js` | Thin `Gio.Settings` wrapper. |
| `lib/mediaPlayerController.js` + `lib/mprisData.js` (+ `.test.js`) | MPRIS2 D-Bus wiring / pure parsing of track metadata and `Can*` capability flags. |
| `lib/brightnessController.js` + `lib/brightnessData.js` (+ `.test.js`) | sysfs read + `login1.SetBrightness` write / pure brightness-percentage math. |

## Backend integration (confirmed live on the target system)

| Tile | Source | Details |
|---|---|---|
| Wi-Fi pill | `NM.Client` (`gi://NM`) | Same client type the existing `wifiIndicator.js` uses. Toggle via `wireless_set_enabled()`. Status text via `parseWifiState`. |
| Bluetooth circle | BlueZ, system bus, `org.bluez` | Adapter at `/org/bluez/hci0`, `org.bluez.Adapter1.Powered` (readable/writable property). Connected-device name comes from any `org.bluez.Device1` object (via `ObjectManager.GetManagedObjects`) with `Connected: true`. Confirmed present and responsive on this machine. |
| Screen Mirroring circle | `Gio.Settings('org.gnome.desktop.remote-desktop.rdp')`, key `enable` (boolean) | The same key GNOME's stock "Screen Sharing" Quick Settings toggle flips. Schema and key confirmed present. |
| Focus pill | `Gio.Settings('org.gnome.desktop.notifications')`, key `show-banners` (boolean, inverted: Focus on ⇒ `show-banners = false`) | The same key GNOME's stock "Do Not Disturb" toggle flips. Confirmed present. |
| Media card | MPRIS2 over the session bus, `org.mpris.MediaPlayer2.*`, discovered/tracked via `NameOwnerChanged` on `org.freedesktop.DBus` | `Previous`/`PlayPause`/`Next` methods on the `Player` interface; button enabled state follows `CanGoPrevious`/`CanPlay`/`CanGoNext`/`CanPause`. Album art: `file://` URIs read directly via `Gio.File`; `http(s)://` URIs fetched async and cached in memory for the session; missing/unset art falls back to a generic music-note glyph. When no MPRIS player is running, or none report `Playing`/`Paused`, the card shows a static "Nothing Playing" state rather than collapsing — the layout always reserves its space. |
| Display slider | Read: `/sys/class/backlight/intel_backlight/brightness` and `.../max_brightness` (world-readable, confirmed). Write: `org.freedesktop.login1.Session.SetBrightness('backlight', 'intel_backlight', value)`, confirmed callable without elevated privileges. There is no `/session/self` alias on this system (verified) — the session object path is resolved once at startup via `org.freedesktop.login1.Manager.GetSessionByPID(0)` (PID `0` auto-resolves to the caller), the same mechanism GNOME Shell's own `js/misc/loginManager.js` uses internally. | External changes (hardware brightness keys) are picked up via a `Gio.File` monitor on the sysfs `brightness` file; a guard flag prevents the monitor callback from re-triggering a `SetBrightness` call when the change originated from the slider itself. |

Screen Mirroring and Focus intentionally read/write the exact GSettings
keys GNOME's own stock toggles use, so the Control Center version and
the (hidden) stock Quick Settings version can never disagree.

Since the backlight device name (`intel_backlight`) and BlueZ adapter
path (`hci0`) are read from the live system rather than hardcoded
assumptions, `brightnessController.js` enumerates
`/sys/class/backlight/` for the first available device and
`bluetoothController.js` enumerates BlueZ adapters via
`ObjectManager`, rather than assuming these exact names — the values
above are what was confirmed present on this machine during design,
not literals to hardcode.

## Visual design

New, isolated style-class namespace in `stylesheet.css`:
`.macos-control-center-*`, so nothing here can collide with the
existing `.kiwi-*` or `.macos-clock*` rules. Popup width follows the
existing `.kiwi-main-menu` convention (~360px). Designed against
GNOME's default dark popup-menu background.

- **Wi-Fi pill** (`.macos-control-center-wifi-pill`) — capsule shape
  (`border-radius: 999px`), translucent macOS-blue fill
  (`rgba(10,132,255,.35)`), small white icon badge on the left, two-line
  label: bold "Wi-Fi" + dimmed network/status line. The whole pill is
  the click target for the toggle.
- **Bluetooth / Screen Mirroring circles**
  (`.macos-control-center-circle-button`) — equal-size circles, placed
  side by side under the Wi-Fi pill. Off state: translucent white fill
  + blue glyph. On state: solid blue fill + white glyph. Bluetooth's
  circle shows the connected device name as a tooltip when one is
  connected.
- **Focus pill** (`.macos-control-center-focus-pill`) — full-width
  capsule spanning both columns (replacing the two dropped squares from
  the reference), moon-glyph badge + "Focus" label. Off: translucent
  grey fill. On: solid indigo fill (`#5E5CE6`-range) + white text/icon.
- **Media card** (`.macos-control-center-media-card`) — rounded
  rectangle (~18px radius): square album art (~72px, ~14px corner
  radius, music-note fallback glyph) → bold title → dimmed artist
  (both truncated with ellipsis) → row of three icon-only transport
  buttons, evenly spaced, each individually enabled/disabled per its
  MPRIS `Can*` flag.
- **Display slider** (`.macos-control-center-display-card`) —
  full-width tall pill, bold "Display" label, GNOME's reusable `Slider`
  actor (`import {Slider} from 'resource:///org/gnome/shell/ui/slider.js'`
  — the same widget class the stock brightness slider uses) between
  low/high sun glyphs, blue fill track.

All glyphs are stock Adwaita symbolic icon names (e.g.
`network-wireless-symbolic`, `bluetooth-active-symbolic`,
`media-playback-start-symbolic`), matching how every existing indicator
in this codebase already sources its icons. No new icon assets beyond
the Control Center panel-face icon that already exists.

### Layout

Two-column grid inside the popup, built from nested `St.BoxLayout`s
(not a `PopupMenuItem` list):

```
Row A: [ Wi-Fi pill                 ] [                        ]
Row B: [ Bluetooth ○ ] [ Mirror ○   ] [   Media card (tall,    ]
                                        spans rows A+B)          ]
Row C: [ Focus pill — spans full width                          ]
Row D: [ Display brightness slider — spans full width           ]
```

Exact pixel proportions between the left column and the media card are
tuned visually during implementation (Phase 4), not fixed in advance
here.

## Build order / phasing

Each phase lands independently and is checked by reloading GNOME Shell
(Alt+F2, `r`, Enter) on the real desktop before moving to the next:

1. **Popup shell + Wi-Fi pill + Bluetooth circle** — establishes
   `controlCenterIndicator.js`, the `extension.js` wiring change, the
   raw-actors-in-`menu.box` layout technique, and the base
   `.macos-control-center-*` styles. De-risks the architecture first,
   since every later phase reuses this shell.
2. **Screen Mirroring circle + Focus pill** — both are thin GSettings
   wrappers, low complexity, extend the same layout.
3. **Display brightness slider** — introduces the `Slider` actor reuse
   and the sysfs + logind read/write path.
4. **Media card (MPRIS)** — most moving parts (dynamic player
   discovery, async art loading, capability-flag-driven button state),
   saved for last.

## Testing

Unit tests for the new pure `*Data.js` modules, mirroring the existing
`batteryData.test.js` / `wifiData.test.js` pattern:
- `bluetoothData.test.js`
- `mprisData.test.js`
- `brightnessData.test.js`

The D-Bus/GObject glue (`*Controller.js`) and the CSS/layout are not
unit-testable in this repo today — none of the existing indicators are
either. They're verified manually by reloading the Shell at each phase
checkpoint above.
