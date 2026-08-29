import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {relativeLuminance} from './colorUtil.js';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

const TILE_ON_LIGHT_CLASS = 'macos-control-center-tile-on-light';
// Deliberately high -- only a genuinely white/very-light background (a browser showing a
// white page, Files on a white folder view, etc.) should flip the glass dark. Anything more
// sensitive would flip on ordinary mid-tone wallpapers too, which already read fine on the
// default light glass and don't need it. Exported so notificationBannerGlass.js's own
// adaptive sample (same idea, applied to notification banners) uses the exact same cutoff.
export const LIGHT_LUMINANCE_THRESHOLD = 0.78;

/**
 * Adaptive light/dark glass for the Control Center. Samples the actual screen pixel behind
 * the popup with Shell.Screenshot.pick_color() -- the same proven, crash-free mechanism
 * windowColorBlend.js already uses for the top bar's window-touch color -- and toggles a
 * style class on every registered tile so the shared glass recipe in stylesheet.css swaps
 * from its default white-tinted fill to a dark one when that would otherwise go
 * white-on-white over something bright.
 *
 * One-shot per menu-open (see sample()'s caller in controlCenterIndicator.js), not a live
 * continuous sampler: simpler, and "is this bright" only needs checking once when the popup
 * appears, not on every frame.
 */
export class BackgroundAdaptiveController {
    constructor(getSamplePoint) {
        this._getSamplePoint = getSamplePoint;
        this._actors = new Set();
    }

    /** Call once per glass tile actor right after creating it. */
    register(actor) {
        this._actors.add(actor);
    }

    /** Call when the menu opens. */
    async sample() {
        const point = this._getSamplePoint();
        if (!point)
            return;

        let color;
        try {
            const screenshot = new Shell.Screenshot();
            [color] = await screenshot.pick_color(point.x, point.y);
        } catch (e) {
            logError(e, '[macos-top-panel] control center: background sample failed');
            return;
        }
        if (!color)
            return;

        const isLight = relativeLuminance(color.red, color.green, color.blue) >= LIGHT_LUMINANCE_THRESHOLD;
        for (const actor of this._actors) {
            if (isLight)
                actor.add_style_class_name(TILE_ON_LIGHT_CLASS);
            else
                actor.remove_style_class_name(TILE_ON_LIGHT_CLASS);
        }
    }

    /** Call the instant the menu starts closing -- back to the default look for next time. */
    reset() {
        for (const actor of this._actors)
            actor.remove_style_class_name(TILE_ON_LIGHT_CLASS);
    }

    destroy() {
        this.reset();
        this._actors.clear();
    }
}
