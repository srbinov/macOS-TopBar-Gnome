import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {
    glassStyleString, partialGlassDeclarations, shouldUseDarkContent,
    SHARED_RECIPE, DENSE_RECIPE, HOVER_RECIPE, ON_RECIPE,
    ADAPTIVE_RECIPE, ADAPTIVE_HOVER_RECIPE, ADAPTIVE_ON_RECIPE,
} from './liquidGlassIntensity.js';

const PANEL_SCHEMA_ID = 'org.gnome.shell.extensions.macos-top-panel';
const INTERFACE_SCHEMA_ID = 'org.gnome.desktop.interface';

/**
 * Liquid Glass intensity for the Control Center's own tiles (pills, circle buttons, the
 * media card, slider cards) -- and NOT via plain inline `.style`, unlike
 * notificationCenter.js's single persistent panel. That was tried first and was a real,
 * reproducible regression: an inline style wins over ANY non-!important stylesheet
 * selector regardless of specificity, including :hover and .on -- so a static inline
 * style silently broke the Wi-Fi/Bluetooth toggle's own "on" highlight and all hover
 * feedback across the whole Control Center the instant the slider moved off 100.
 *
 * Same supplementary-stylesheet-reload mechanism as notificationBannerGlass.js instead:
 * generates real CSS text (with !important, so it wins the same way that module's does)
 * for the base/:hover/.on states plus the circle-button icon color, and (re)loads it via
 * St.Theme. This lets GNOME's own CSS cascade keep handling :hover/.on normally --
 * nothing here ever touches a live tile actor directly.
 */
export class ControlCenterGlass {
    constructor() {
        this._file = Gio.File.new_for_path(
            GLib.build_filenamev(
                [GLib.get_user_cache_dir(), 'macos-top-panel', 'control-center-glass.css']));
        this._loaded = false;

        this._panelSettings = new Gio.Settings({schema_id: PANEL_SCHEMA_ID});
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA_ID});
        this._settingsChangedId = this._panelSettings.connect(
            'changed::liquid-glass-intensity', () => this._apply());
        this._colorSchemeChangedId = this._interfaceSettings.connect(
            'changed::color-scheme', () => this._apply());

        this._apply();
    }

    _apply() {
        const intensity = this._panelSettings.get_int('liquid-glass-intensity');
        const isDarkMode = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';

        const baseDeclarations = glassStyleString(SHARED_RECIPE, intensity, isDarkMode, true);
        const denseDeclarations = glassStyleString(DENSE_RECIPE, intensity, isDarkMode, true);
        const hoverDeclarations = partialGlassDeclarations(HOVER_RECIPE, intensity, isDarkMode);
        const onDeclarations = partialGlassDeclarations(ON_RECIPE, intensity, isDarkMode);

        // Adaptive dark tiles (backgroundAdaptiveController.js's .macos-control-center-
        // tile-on-light, toggled per-tile when it samples something bright behind the
        // popup) always interpolate toward SOLID_DARK -- forced true here regardless of
        // isDarkMode above, since what's driving "this needs to be dark" is the sampled
        // content behind the popup, not the system light/dark setting; a tile can get
        // flagged in either system mode.
        const adaptiveDeclarations = glassStyleString(ADAPTIVE_RECIPE, intensity, true, true);
        const adaptiveHoverDeclarations = partialGlassDeclarations(ADAPTIVE_HOVER_RECIPE, intensity, true);
        const adaptiveOnDeclarations = partialGlassDeclarations(ADAPTIVE_ON_RECIPE, intensity, true);

        // Binary, not interpolated -- see DARK_CONTENT_THRESHOLD's own doc for why (some
        // circle-button icons are pre-baked PNGs that can only ever be swapped, not
        // smoothly recolored, so everything content-colored uses the same hard cutoff
        // those get swapped at instead of drifting out of sync with them). dark/light
        // here are just the two icon-color tones this project already uses everywhere
        // else (icons/panel/*-white.png vs *-black.png, and battery/dock foreground).
        const dark = shouldUseDarkContent(intensity, isDarkMode);
        const titleColor = dark ? 'rgba(28, 28, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        const subtitleColor = dark ? 'rgba(28, 28, 30, 0.75)' : 'rgba(255, 255, 255, 0.85)';
        const iconColor = dark ? 'rgba(28, 28, 30, 0.9)' : 'rgba(255, 255, 255, 0.95)';
        // Slider track (inactive portion) -- visibly present, not a hairline, but still
        // reads as a recessed groove rather than a second bar.
        const trackColor = dark ? 'rgba(28, 28, 30, 0.32)' : 'rgba(255, 255, 255, 0.4)';
        // Slider active-bar + handle -- FULLY opaque (not the translucent iconColor used
        // for everything else). Verified against the real BarLevel/Slider source
        // (gresource extract .../libshell-18.so /org/gnome/shell/ui/slider.js): the handle
        // is a small (16px default) filled circle drawn from themeNode.get_foreground_color()
        // (the plain `color` property) -- at iconColor's 0.9-0.95 alpha it was still too
        // faint to read as a solid dot at that size, especially against a translucent card
        // showing wallpaper through it. Solid, no alpha, is the only way to guarantee it
        // reads as a dot rather than a smudge.
        const sliderContentColor = dark ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)';

        const css = `
.macos-control-center-pill,
.macos-control-center-circle-button,
.macos-control-center-media-card {
    ${baseDeclarations}
}
.macos-control-center-slider-card {
    ${denseDeclarations}
}
.macos-control-center-pill:hover,
.macos-control-center-circle-button:hover {
    ${hoverDeclarations}
}
.macos-control-center-pill.on,
.macos-control-center-circle-button.on {
    ${onDeclarations}
}
.macos-control-center-pill.macos-control-center-tile-on-light,
.macos-control-center-circle-button.macos-control-center-tile-on-light,
.macos-control-center-media-card.macos-control-center-tile-on-light,
.macos-control-center-slider-card.macos-control-center-tile-on-light {
    ${adaptiveDeclarations}
}
.macos-control-center-pill.macos-control-center-tile-on-light:hover,
.macos-control-center-circle-button.macos-control-center-tile-on-light:hover {
    ${adaptiveHoverDeclarations}
}
.macos-control-center-pill.on.macos-control-center-tile-on-light,
.macos-control-center-circle-button.on.macos-control-center-tile-on-light {
    ${adaptiveOnDeclarations}
}
.macos-control-center-circle-button StIcon,
.macos-control-center-slider-card StIcon,
.macos-control-center-transport-button,
.macos-control-center-transport-button StIcon {
    color: ${iconColor} !important;
}
.macos-control-center-pill-title,
.macos-control-center-media-title,
.macos-control-center-slider-card .macos-control-center-pill-title {
    color: ${titleColor} !important;
}
.macos-control-center-pill-subtitle,
.macos-control-center-media-artist {
    color: ${subtitleColor} !important;
}
/* The Slider widget (js/ui/slider.js) draws its own track/active-bar/handle from
   -barlevel-*/color theme properties, not children this stylesheet can select into --
   MacTahoe's own .slider rule (gnome-shell.css) sets -barlevel-active-background-color:
   white and color: transparent (handle only appears white on :hover), tuned for sitting on
   a dark Quick Settings backdrop. On our liquid-glass cards that's backwards: a white bar
   on a white/near-solid card (low intensity, light mode) is exactly as invisible as the
   circle-button icons were. Tied to the same dark/light content decision as those, reusing
   iconColor so the handle/active-bar read as the same tone as everything else on the tile. */
.macos-control-center-slider-card .slider,
.macos-control-center-slider-card .slider:hover {
    -barlevel-background-color: ${trackColor} !important;
    -barlevel-active-background-color: ${sliderContentColor} !important;
    color: ${sliderContentColor} !important;
}
/* Adaptive tiles force LIGHT content regardless of the intensity/system-mode-driven
   iconColor/titleColor/subtitleColor/trackColor/sliderContentColor above -- the tile went
   dark because backgroundAdaptiveController.js sampled something bright behind it, which
   is independent of (and can disagree with) the global Liquid Glass decision, e.g. light
   system mode + low intensity already chose dark content globally, but this one specific
   tile is dark-glass over a bright page, so it still needs light content on top of it.
   Compound selectors (2 classes, sometimes +descendant) so these naturally out-specificity
   the plain rules above without needing source-order luck. Transport buttons/media text
   aren't registered with BackgroundAdaptiveController themselves (only the whole media
   card is), hence the ancestor-qualified selectors for those two. */
.macos-control-center-circle-button.macos-control-center-tile-on-light StIcon,
.macos-control-center-slider-card.macos-control-center-tile-on-light StIcon,
.macos-control-center-media-card.macos-control-center-tile-on-light .macos-control-center-transport-button,
.macos-control-center-media-card.macos-control-center-tile-on-light .macos-control-center-transport-button StIcon {
    color: rgba(255, 255, 255, 0.95) !important;
}
.macos-control-center-pill.macos-control-center-tile-on-light .macos-control-center-pill-title,
.macos-control-center-media-card.macos-control-center-tile-on-light .macos-control-center-media-title,
.macos-control-center-slider-card.macos-control-center-tile-on-light .macos-control-center-pill-title {
    color: rgba(255, 255, 255, 0.95) !important;
}
.macos-control-center-pill.macos-control-center-tile-on-light .macos-control-center-pill-subtitle,
.macos-control-center-media-card.macos-control-center-tile-on-light .macos-control-center-media-artist {
    color: rgba(255, 255, 255, 0.85) !important;
}
.macos-control-center-slider-card.macos-control-center-tile-on-light .slider,
.macos-control-center-slider-card.macos-control-center-tile-on-light .slider:hover {
    -barlevel-background-color: rgba(255, 255, 255, 0.35) !important;
    -barlevel-active-background-color: rgb(255, 255, 255) !important;
    color: rgb(255, 255, 255) !important;
}
`;

        try {
            const dir = this._file.get_parent();
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
            this._file.replace_contents(
                css, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            logError(e, '[macos-top-panel] failed to write control center glass stylesheet');
            return;
        }

        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (!theme)
            return;
        try {
            if (this._loaded)
                theme.unload_stylesheet(this._file);
            theme.load_stylesheet(this._file);
            this._loaded = true;
        } catch (e) {
            logError(e, '[macos-top-panel] failed to (re)load control center glass stylesheet');
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
