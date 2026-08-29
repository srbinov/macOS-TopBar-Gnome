import Shell from 'gi://Shell';
import St from 'gi://St';

const BLUR_NAME = 'macos-control-center-tile-blur';
const BLUR_RADIUS = 24;
// 0.75 was tried first and was nowhere near enough: blurring a solid-white page and only
// dimming to 75% is still ~191/255 (light gray), and the glass fill on top of that is
// ALSO white-tinted -- net result reads as white-on-white, invisible. This needs to pull
// bright content most of the way to a dark neutral so text/icons stay legible regardless
// of what's behind the tile (white page, wallpaper, dark window -- doesn't matter).
const BLUR_BRIGHTNESS = 0.3;

/**
 * Per-tile Shell.BlurEffect (BACKGROUND mode) for the Control Center's glass widgets.
 *
 * NOT attached to the popup/BoxPointer itself -- that's the documented hard-rule crash
 * (docs/liquid-glass-style.md: "Clutter paint abort after screenshot UI / teardown",
 * `clutter_actor_node_new: actor != NULL`). The actual trigger was a live blur effect
 * still attached while the menu tore down during the screenshot-UI handoff.
 *
 * This controller sidesteps that by scoping blur to individual leaf tiles and enforcing
 * a strict lifecycle: effects only exist while the menu is actually open, and are ripped
 * off synchronously the instant closing starts (register() / enable() / disable() below),
 * never left attached through a close animation or a screenshot-UI handoff.
 */
export class TileBlurController {
    constructor() {
        this._actors = new Set();
    }

    /** Call once per glass tile actor right after creating it. */
    register(actor) {
        this._actors.add(actor);
    }

    /** Call when the menu opens. */
    enable() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        for (const actor of this._actors) {
            try {
                actor.remove_effect_by_name(BLUR_NAME);
                actor.add_effect_with_name(BLUR_NAME, new Shell.BlurEffect({
                    name: BLUR_NAME,
                    mode: Shell.BlurMode.BACKGROUND,
                    radius: BLUR_RADIUS * scale,
                    brightness: BLUR_BRIGHTNESS,
                }));
            } catch (e) {
                logError(e, '[macos-top-panel] control center: failed to attach tile blur');
            }
        }
    }

    /** Call the instant the menu starts closing (and before opening the screenshot UI). */
    disable() {
        for (const actor of this._actors) {
            try {
                actor.remove_effect_by_name(BLUR_NAME);
            } catch (e) {
                // Actor may already be mid-destroy -- nothing to clean up either way.
            }
        }
    }

    destroy() {
        this.disable();
        this._actors.clear();
    }
}
