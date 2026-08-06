#!/bin/bash
set -e

EXTENSION_UUID="macos-top-panel@local.dev"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo "Compiling GSettings schemas..."
glib-compile-schemas "$SOURCE_DIR/schemas/"

if [ -e "$EXTENSION_DIR" ]; then
    echo "Already linked: $EXTENSION_DIR"
else
    echo "Linking $SOURCE_DIR -> $EXTENSION_DIR"
    ln -s "$SOURCE_DIR" "$EXTENSION_DIR"
fi

echo "Done. Restart GNOME Shell (Alt+F2, r, Enter on X11; log out/in on Wayland) to pick up changes."
