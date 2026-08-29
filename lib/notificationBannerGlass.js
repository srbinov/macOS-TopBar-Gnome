import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';

import {glassStyleString, shouldUseDarkContent, SHARED_RECIPE, ADAPTIVE_RECIPE} from './liquidGlassIntensity.js';
import {relativeLuminance} from './colorUtil.js';
import {LIGHT_LUMINANCE_THRESHOLD} from './backgroundAdaptiveController.js';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

const PANEL_SCHEMA_ID = 'org.gnome.shell.extensions.macos-top-panel';
const INTERFACE_SCHEMA_ID = 'org.gnome.desktop.interface';

/**
 * .notification-banner (GNOME's own ephemeral, per-notification actor -- not something
 * this extension creates or owns the lifecycle of, unlike the Control Center tiles or the
 * Notification Center panel) can't take the plain-inline-style treatment those get: its
 * stylesheet.css rule uses !important (it has to, to beat the MacTahoe theme's own
 * competing .notification-banner rule -- see that rule's own comment), and an !important
 * stylesheet rule beats a plain inline style regardless of what set it.
 *
 * So instead, this generates a small supplementary stylesheet with the CURRENT
 * interpolated values (also !important, to match) and (re)loads it via St.Theme --
 * confirmed against this project's own real, working usage of the same
 * load_stylesheet/unload_stylesheet API in perfect-lockscreen@chris/pro.js. Loaded AFTER
 * the extension's own stylesheet.css, so it wins the !important-vs-!important tie by load
 * order. This never touches a live notification-banner actor directly -- no risk of the
 * signal-connection-on-an-ephemeral-actor crash class documented in dock.js's own tail-
 * positioning fix (macOS-Dock-2026-peachOS), since nothing here connects to one at all.
 *
 * Also owns the same adaptive-dark-over-bright-content behavior Control Center's tiles get
 * from BackgroundAdaptiveController (backgroundAdaptiveController.js) -- explicitly asked
 * for after that regression got fixed there. Banners don't have a per-tile register()/class
 * list the way Control Center's tiles do (there's normally only ever one banner actually
 * visible at a time, GNOME queues the rest), so this is simpler: one sampled flag, applied
 * to the single shared stylesheet every other banner already goes through. sampleAdaptive()
 * is called from notificationTray.js's own monkey-patched showing-hook (see that file) --
 * NOT a signal connected to the ephemeral banner actor itself, same crash class this file's
 * own comment above already avoids.
 */
export class NotificationBannerGlass {
    constructor() {
        this._file = Gio.File.new_for_path(
            GLib.build_filenamev(
                [GLib.get_user_cache_dir(), 'macos-top-panel', 'notification-glass.css']));
        this._loaded = false;
        this._forceAdaptiveDark = false;

        this._panelSettings = new Gio.Settings({schema_id: PANEL_SCHEMA_ID});
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA_ID});
        this._settingsChangedId = this._panelSettings.connect(
            'changed::liquid-glass-intensity', () => this._apply());
        this._colorSchemeChangedId = this._interfaceSettings.connect(
            'changed::color-scheme', () => this._apply());

        this._apply();
    }

    /**
     * @param {{x: number, y: number}} point screen point behind where the banner is about
     *   to rest -- see notificationTray.js's own sample-point computation for why it has to
     *   be captured before this is called, not inside it.
     */
    async sampleAdaptive(point) {
        let color;
        try {
            const screenshot = new Shell.Screenshot();
            [color] = await screenshot.pick_color(point.x, point.y);
        } catch (e) {
            logError(e, '[macos-top-panel] notification banner: background sample failed');
            return;
        }
        if (!color || !this._panelSettings)
            return; // destroy() may have already torn this down while the sample was in flight

        this._forceAdaptiveDark = relativeLuminance(color.red, color.green, color.blue) >= LIGHT_LUMINANCE_THRESHOLD;
        this._apply();
    }

    _apply() {
        if (!this._panelSettings)
            return;
        const intensity = this._panelSettings.get_int('liquid-glass-intensity');
        // Forced true when sampleAdaptive() found something bright behind the banner --
        // same reasoning as ControlCenterGlass's own ADAPTIVE_RECIPE use: what's driving
        // "this needs to be dark" is the sampled content, not the system light/dark
        // setting, so it always targets the same SOLID_DARK endpoint regardless of
        // isDarkMode below.
        const isDarkMode = this._forceAdaptiveDark ||
            this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        const recipe = this._forceAdaptiveDark ? ADAPTIVE_RECIPE : SHARED_RECIPE;
        const declarations = glassStyleString(recipe, intensity, isDarkMode, true);

        // Text color: NOT theme-owned, deliberately -- .notification-banner's own `color`
        // (inherited by .message-title/body, neither of which sets its own) comes from
        // whichever MacTahoe gnome-shell.css happens to be loaded, and peachOS's dark-mode
        // toggle only ever flips org.gnome.desktop.interface color-scheme -- there's no
        // user-theme extension installed (confirmed: that schema doesn't exist on this
        // system) and nothing else that swaps the actual shell theme file, so gnome-shell
        // always loads MacTahoe-Light's gnome-shell.css regardless of dark mode. That
        // theme hardcodes color: #242424 (dark text) unconditionally -- fine as long as
        // our own interpolated background stays light-ish, but at low intensity in dark
        // mode the background correctly goes solid near-black (SOLID_DARK) while the text
        // stayed theme-dark the whole time, becoming unreadable. Same
        // shouldUseDarkContent() used for Control Center content: in dark mode it's always
        // false (our own SOLID_DARK target is already dark, light text is always correct
        // against it, at every intensity), in light mode it flips dark past the halfway
        // point -- exactly matching what OUR OWN background is actually doing, unlike the
        // theme's static value.
        const dark = shouldUseDarkContent(intensity, isDarkMode);
        const textColor = dark ? 'rgba(28, 28, 30, 0.95)' : 'rgba(222, 222, 222, 0.95)';

        const css = `.notification-banner {\n    ${declarations}\n    color: ${textColor} !important;\n}\n`;

        try {
            const dir = this._file.get_parent();
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
            this._file.replace_contents(
                css, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            logError(e, '[macos-top-panel] failed to write notification glass stylesheet');
            return;
        }

        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (!theme)
            return;
        try {
            // unload-then-load even on an already-loaded file: load_stylesheet() alone
            // doesn't re-read changed content from a path it already has loaded.
            if (this._loaded)
                theme.unload_stylesheet(this._file);
            theme.load_stylesheet(this._file);
            this._loaded = true;
        } catch (e) {
            logError(e, '[macos-top-panel] failed to (re)load notification glass stylesheet');
        }
    }

    destroy() {
        if (this._settingsChangedId) {
            this._panelSettings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._colorSchemeChangedId) {
            this._interfaceSettings.disconnect(this._colorSchemeChangedId);
            this._colorSchemeChangedId = 0;
        }
        if (this._loaded) {
            try {
                St.ThemeContext.get_for_stage(global.stage).get_theme()?.unload_stylesheet(this._file);
            } catch (e) {
                // Theme already gone (e.g. shell shutting down) -- nothing to clean up.
            }
            this._loaded = false;
        }
        this._panelSettings = null;
        this._interfaceSettings = null;
    }
}
