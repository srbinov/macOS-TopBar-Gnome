// Shared interpolation math for the "Liquid Glass" intensity slider (peachOS Settings ->
// Appearance -> Liquid Glass). At intensity=100 every glass surface this covers (Control
// Center, Notification Center, notification banners -- NOT the dock, which has its own
// separate liquid-glass-mode concept in macOS-Dock-2026-peachOS) looks exactly like it
// always has: a translucent white-tinted card, per the shared recipe in
// docs/liquid-glass-style.md. At intensity=0 it's fully solid/opaque instead: white in
// light system mode, a dark macOS-style surface gray (#1c1c1e -- matches this project's own
// DARK_TARGET convention used elsewhere for icon dark-mode) in dark system mode. Everything
// in between is a straight linear blend on both hue and alpha, so 50 really is "halfway
// between solid and full glass," not an approximation.

const SOLID_LIGHT = {r: 255, g: 255, b: 255};
const SOLID_DARK = {r: 28, g: 28, b: 30};

// The shared glass recipe (docs/liquid-glass-style.md) at 100% intensity -- exactly the
// values already in stylesheet.css's Control Center base recipe, .notification-banner, and
// .macos-notification-center (all three use this identical recipe today).
export const SHARED_RECIPE = {
    fill: {r: 255, g: 255, b: 255, a: 0.12},
    gradientStart: {r: 255, g: 255, b: 255, a: 0.28},
    gradientEnd: {r: 255, g: 255, b: 255, a: 0.08},
    border: {r: 255, g: 255, b: 255, a: 0.42},
    shadow: {r: 255, g: 255, b: 255, a: 0.5},
};

// The denser variant Display/Volume slider cards use -- same border/shadow as
// SHARED_RECIPE, only the fill/gradient stops run a bit lower.
export const DENSE_RECIPE = {
    fill: {r: 255, g: 255, b: 255, a: 0.1},
    gradientStart: {r: 255, g: 255, b: 255, a: 0.22},
    gradientEnd: {r: 255, g: 255, b: 255, a: 0.06},
    border: SHARED_RECIPE.border,
    shadow: SHARED_RECIPE.shadow,
};

// :hover / .on partial overrides for pills and circle buttons -- exactly the values
// already in stylesheet.css's own :hover/.on blocks. No shadow entry: neither block
// overrides box-shadow today, it falls through to the base recipe's, same as before.
export const HOVER_RECIPE = {
    fill: {r: 255, g: 255, b: 255, a: 0.16},
    gradientStart: {r: 255, g: 255, b: 255, a: 0.36},
    gradientEnd: {r: 255, g: 255, b: 255, a: 0.12},
    border: {r: 255, g: 255, b: 255, a: 0.55},
};
export const ON_RECIPE = {
    fill: {r: 255, g: 255, b: 255, a: 0.22},
    gradientStart: {r: 255, g: 255, b: 255, a: 0.42},
    gradientEnd: {r: 255, g: 255, b: 255, a: 0.16},
    border: {r: 255, g: 255, b: 255, a: 0.58},
};

// backgroundAdaptiveController.js's own recipe -- dark glass for a Control Center tile
// sampled as sitting over something bright (a white webpage, Files on a light folder),
// exactly the values that used to live directly in stylesheet.css's own
// .macos-control-center-tile-on-light rules before the Liquid Glass slider existed. Kept
// here (rather than left as static CSS) so ControlCenterGlass's own dynamically-reloaded
// !important stylesheet can include it too -- a real regression the slider introduced:
// a plain, non-!important compound selector (however much higher its specificity) still
// loses to ANY !important rule, so once the base/hover/.on tiles became !important-driven,
// this adaptive dark variant stopped visibly doing anything at all.
export const ADAPTIVE_RECIPE = {
    fill: {r: 20, g: 20, b: 24, a: 0.55},
    gradientStart: {r: 50, g: 50, b: 56, a: 0.55},
    gradientEnd: {r: 10, g: 10, b: 12, a: 0.72},
    border: {r: 255, g: 255, b: 255, a: 0.2},
    shadow: {r: 255, g: 255, b: 255, a: 0.28},
};
export const ADAPTIVE_HOVER_RECIPE = {
    fill: {r: 35, g: 35, b: 40, a: 0.62},
    gradientStart: {r: 65, g: 65, b: 72, a: 0.6},
    gradientEnd: {r: 15, g: 15, b: 18, a: 0.78},
    border: {r: 255, g: 255, b: 255, a: 0.32},
};
export const ADAPTIVE_ON_RECIPE = {
    fill: {r: 50, g: 50, b: 58, a: 0.72},
    gradientStart: {r: 80, g: 80, b: 90, a: 0.68},
    gradientEnd: {r: 20, g: 20, b: 24, a: 0.85},
    border: {r: 255, g: 255, b: 255, a: 0.42},
};

function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * @param {{r:number,g:number,b:number,a:number}} glassColor the color/alpha this surface
 *   uses today, at 100% intensity (i.e. whatever's hardcoded in stylesheet.css).
 * @param {number} intensity 0-100
 * @param {boolean} isDarkMode
 * @param {number} [solidAlpha] alpha at intensity=0. Defaults to 1 (fully opaque) --
 *   right for fill/gradient stops, which should become a solid card. Pass a lower value
 *   for border/shadow, which should fade toward faint/invisible instead, not opaque.
 * @returns {{r:number,g:number,b:number,a:number}}
 */
export function interpolateGlassColor(glassColor, intensity, isDarkMode, solidAlpha = 1) {
    const t = Math.max(0, Math.min(100, intensity)) / 100;
    const solid = isDarkMode ? SOLID_DARK : SOLID_LIGHT;
    return {
        r: Math.round(lerp(solid.r, glassColor.r, t)),
        g: Math.round(lerp(solid.g, glassColor.g, t)),
        b: Math.round(lerp(solid.b, glassColor.b, t)),
        a: lerp(solidAlpha, glassColor.a, t),
    };
}

/** @param {{r:number,g:number,b:number,a:number}} c */
export function rgba(c) {
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}

// Below this intensity, in light mode, the panel background is opaque/bright enough that
// white icons and text stop being readable against it -- everything content-colored
// (icons, pill/media/slider text) switches to a dark tint as a single hard cutoff rather
// than a smooth fade. Deliberately binary, not interpolated: some circle-button icons are
// pre-baked white PNGs (screenshot/appearance/airdrop/calculator/timer), not symbolic
// vector icons -- a PNG's own pixels can't be smoothly recolored via CSS `color` the way
// a symbolic icon's can (that's a real bug an earlier version of this hit: the CSS-only
// fix did nothing for those five, only for the three that happen to use icon_name
// strings). A PNG can still be *swapped* to a separate pre-rendered dark variant though,
// which is a binary decision by nature -- so the symbolic/text CSS path uses the exact
// same cutoff instead of its own smooth gradient, so every piece of content-on-glass
// switches at the same moment and nothing looks mismatched.
export const DARK_CONTENT_THRESHOLD = 50;

/**
 * @param {number} intensity
 * @param {boolean} isDarkMode
 * @returns {boolean} true when icons/text need the dark tint to stay visible. Dark
 *   system mode's solid target is already dark, so white content stays visible there at
 *   every intensity -- this is only ever true in light mode.
 */
export function shouldUseDarkContent(intensity, isDarkMode) {
    return !isDarkMode && intensity < DARK_CONTENT_THRESHOLD;
}

/**
 * Partial declarations for :hover/.on blocks -- background-color/gradient stops/
 * border-COLOR only (the shorthand `border` isn't repeated -- stylesheet.css's own
 * :hover/.on rules only ever override border-color, leaving the 1px/solid parts to
 * fall through from the base rule, same as this replicates).
 * @param {{fill,gradientStart,gradientEnd,border}} partialRecipe
 * @param {number} intensity
 * @param {boolean} isDarkMode
 */
export function partialGlassDeclarations(partialRecipe, intensity, isDarkMode) {
    const fill = interpolateGlassColor(partialRecipe.fill, intensity, isDarkMode);
    const gradientStart = interpolateGlassColor(partialRecipe.gradientStart, intensity, isDarkMode);
    const gradientEnd = interpolateGlassColor(partialRecipe.gradientEnd, intensity, isDarkMode);
    const border = interpolateGlassColor(partialRecipe.border, intensity, isDarkMode, 0.18);

    return [
        `background-color: ${rgba(fill)} !important;`,
        `background-gradient-start: ${rgba(gradientStart)} !important;`,
        `background-gradient-end: ${rgba(gradientEnd)} !important;`,
        `border-color: ${rgba(border)} !important;`,
    ].join(' ');
}

/**
 * One surface's full recipe at 100% intensity -- the exact values already in
 * stylesheet.css for that surface's shared-glass-recipe block.
 * @typedef {{fill: {r,g,b,a}, gradientStart: {r,g,b,a}, gradientEnd: {r,g,b,a},
 *   border: {r,g,b,a}, shadow: {r,g,b,a}}} GlassRecipe
 */

/**
 * Computes the interpolated recipe for one surface and returns it as a ready-to-use St
 * inline-style string (background-color/gradient/border/box-shadow), for callers that own
 * their actor's whole lifecycle (Control Center tiles, the Notification Center panel) and
 * can just set `.style` directly. Border/shadow alpha floors (0.18 / 0) are deliberately
 * lower than the fill/gradient stops' floor of 1 -- see interpolateGlassColor()'s own
 * doc for why.
 * @param {GlassRecipe} recipe
 * @param {number} intensity
 * @param {boolean} isDarkMode
 * @param {boolean} [important] appends `!important` to every declaration -- for a
 *   caller writing an actual stylesheet rule that has to out-!important the theme's own
 *   competing rule (.notification-banner, via notificationBannerGlass.js), not for plain
 *   `.style` assignment (where !important is meaningless -- there's no cascade to win).
 */
export function glassStyleString(recipe, intensity, isDarkMode, important = false) {
    const fill = interpolateGlassColor(recipe.fill, intensity, isDarkMode);
    const gradientStart = interpolateGlassColor(recipe.gradientStart, intensity, isDarkMode);
    const gradientEnd = interpolateGlassColor(recipe.gradientEnd, intensity, isDarkMode);
    const border = interpolateGlassColor(recipe.border, intensity, isDarkMode, 0.18);
    const shadow = interpolateGlassColor(recipe.shadow, intensity, isDarkMode, 0);
    const bang = important ? ' !important' : '';

    return [
        `background-color: ${rgba(fill)}${bang};`,
        `background-gradient-direction: vertical${bang};`,
        `background-gradient-start: ${rgba(gradientStart)}${bang};`,
        `background-gradient-end: ${rgba(gradientEnd)}${bang};`,
        `border: 1px solid ${rgba(border)}${bang};`,
        `box-shadow: inset 0 1px 0 ${rgba(shadow)}${bang};`,
    ].join(' ');
}
