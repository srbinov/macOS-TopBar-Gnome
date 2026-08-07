# macOS-style Top Panel for GNOME

A GNOME Shell extension that reshapes the top bar into a macOS-style menu
bar: an Apple-style system menu on the left, a live per-app
File/Edit/View/Go/Window/Help bar next to it, and a cleaned-up
battery/Wi-Fi/sound/Quick Settings/clock cluster on the right.

> **Personal use.** Built for a single desktop's own workflow rather than
> broad distribution — no extensions.gnome.org listing, no warranty. Feel
> free to fork and tweak it for yours.

## Features

- **Apple-style system menu** — a Kiwi-menu-derived Apple icon on the far
  left with About This PC, App Store, Force Quit, Lock, Log Out, Restart,
  and Shut Down, plus a custom menu item slot for your own command.
- **Live app menu bar** — File/Edit/View/Go/Window/Help labels next to the
  focused app's name, mirroring how macOS shows the active app's menus.
- **Custom menus** — add any number of your own top-level menus, each item
  running a shell command or sending a keyboard shortcut.
- **Redesigned status area** — dedicated battery, Wi-Fi, and sound
  indicators with custom macOS-style icons, plus the stock Quick Settings
  panel relocated and decluttered (hide the lock/power/settings quick
  buttons individually).
- **Clock customization** — pick a custom font (drag a `.ttf`/`.otf`
  file onto the preferences window to install it) and adjust the clock's
  font size.
- **Adjustable panel height** and an optional **window-color-blend**
  background: when a window touches the top of the screen, the panel
  samples and matches that window's color there.
- **User switcher** in the system menu for fast account switching.
- Translations included for German, Spanish, Estonian, Persian, Finnish,
  French, Italian, Korean, Lithuanian, Latvian, Norwegian Bokmål, Dutch,
  Polish, Portuguese, Swedish, Turkish, and Simplified Chinese.

## Requirements

- GNOME Shell **50**
- `glib-compile-schemas` (ships with GLib/glib2, already present on
  virtually every GNOME desktop)

## Installation

### Option 1 — install script (recommended)

```bash
git clone https://github.com/srbinov/macOS-TopBar-Gnome.git
cd macOS-TopBar-Gnome
./install.sh
```

This compiles the GSettings schemas and symlinks the repo into
`~/.local/share/gnome-shell/extensions/macos-top-panel@local.dev`, so
`git pull` later updates the live extension too.

### Option 2 — manual copy

```bash
git clone https://github.com/srbinov/macOS-TopBar-Gnome.git
mkdir -p ~/.local/share/gnome-shell/extensions/macos-top-panel@local.dev
cp -r macOS-TopBar-Gnome/* ~/.local/share/gnome-shell/extensions/macos-top-panel@local.dev/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/macos-top-panel@local.dev/schemas/
```

### Enable the extension

Restart GNOME Shell to pick up the new extension, then enable it:

- **X11:** press `Alt+F2`, type `r`, press Enter.
- **Wayland:** log out and back in.

Then enable it with the Extensions app, or from a terminal:

```bash
gnome-extensions enable macos-top-panel@local.dev
```

## Configuring

Open preferences from the Extensions app, or run:

```bash
gnome-extensions prefs macos-top-panel@local.dev
```

From there you can:

- Change the system-menu icon and its App Store command.
- Set or clear the Force Quit shortcut, and toggle macOS-style shortcut
  glyphs (⌘ ⌥ ^ ⎋).
- Add a custom system-menu entry with its own label, icon, and command.
- Toggle the Activities button and individual Quick Settings buttons.
- Enable/disable the built-in File/Edit/View/Go/Window/Help menus and
  manage the Global Menu's custom menus.
- Set the panel height, install a custom clock font and size, and toggle
  window-color-blend for the panel background.

## Updating

If you installed via `install.sh`, just pull:

```bash
cd macOS-TopBar-Gnome
git pull
```

Then restart GNOME Shell as above.

## Uninstalling

```bash
gnome-extensions disable macos-top-panel@local.dev
rm ~/.local/share/gnome-shell/extensions/macos-top-panel@local.dev
```

(The last command removes the symlink created by `install.sh`; if you used
the manual copy method, `rm -r` the directory instead.)

## Project layout

```
extension.js     Entry point: wires up the panel, menus, and indicators
lib/              Panel-level features (clock, battery/Wi-Fi/sound
                   indicators, window-color-blend, panel state)
src/              Kiwi-menu-derived system menu, Quick Settings tweaks,
                   user switcher
schemas/          GSettings schemas for the extension's preferences
icons/            Symbolic icons used across the panel and menus
po/                Translations
tests/            Automated test suites
prefs.js          Preferences window (GTK4/Adwaita)
install.sh        Compiles schemas and symlinks the extension into place
```

## Contributing

This started as a personal customization project, so issues and PRs are
welcome but roadmap direction is driven by what's useful on the author's
own desktop.
