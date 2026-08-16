import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Opens GNOME's interactive screenshot UI. No persistent state — fire-and-forget.
 */
export class ScreenshotController {
    constructor() {
        this._openTimeoutId = 0;
    }

    open(closeMenu) {
        try {
            if (this._openTimeoutId) {
                GLib.source_remove(this._openTimeoutId);
                this._openTimeoutId = 0;
            }

            closeMenu?.();

            // Wait for the popup close animation to finish before opening the
            // screenshot UI. Opening immediately can race Clutter paint with
            // the still-tearing-down menu actor.
            this._openTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this._openTimeoutId = 0;
                try {
                    Main.screenshotUI?.open?.();
                } catch (e) {
                    logError(e, '[macos-top-panel] control center: failed to open screenshot UI');
                }
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to open screenshot UI');
        }
    }

    destroy() {
        if (this._openTimeoutId) {
            GLib.source_remove(this._openTimeoutId);
            this._openTimeoutId = 0;
        }
    }
}
