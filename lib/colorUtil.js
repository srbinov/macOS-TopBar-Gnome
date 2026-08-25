/**
 * Color helpers for panel contrast (wallpaper / blend sampling).
 */

/**
 * Relative luminance (WCAG), channels 0–255.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0–1
 */
export function relativeLuminance(r, g, b) {
    const lin = c => {
        const s = Math.max(0, Math.min(255, c)) / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Pick panel chrome foreground for a sampled background.
 * Light backgrounds → black text/icons; dark → white.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} [threshold=0.55]
 * @returns {'black'|'white'}
 */
export function foregroundForBackground(r, g, b, threshold = 0.55) {
    return relativeLuminance(r, g, b) > threshold ? 'black' : 'white';
}

/**
 * @param {{r: number, g: number, b: number, a?: number}} color
 * @returns {string}
 */
export function formatRgba(color) {
    const a = color.a === undefined ? 1 : color.a;
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`;
}

/**
 * @param {{r: number, g: number, b: number}} color
 * @returns {string}
 */
export function formatRgb(color) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

// How far below the panel's own bottom edge to sample when a window is touching it. The
// pixel right at the seam (panelBottom + 0/1px) is frequently the window's own CSD border,
// shadow, or a 1px compositing gap -- reads as white/light grey regardless of the window's
// real chrome color. 8px is far enough in to land on the actual title bar / tab strip.
export const WINDOW_TOUCH_SAMPLE_INSET = 8;

/**
 * Opaque fill for the panel while a window touches it. Deliberately not rgba(): the panel
 * sits over the desktop wallpaper, so any alpha < 1 blends the sampled window color with
 * whatever wallpaper is showing through underneath -- a dark window chrome sampled at, say,
 * 60% over a blue wallpaper paints slate-blue on screen, not the charcoal the window itself
 * actually is. An opaque fill is the only way the bar reads as "this window's real color."
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function windowTouchFill(r, g, b) {
    return formatRgb({r: Math.round(r), g: Math.round(g), b: Math.round(b)});
}

/**
 * Stage-coordinate Y to sample at when a window is touching the panel -- see
 * WINDOW_TOUCH_SAMPLE_INSET for why this isn't just panelY + panelHeight.
 * @param {number} panelY
 * @param {number} panelHeight
 * @returns {number}
 */
export function windowTouchSampleY(panelY, panelHeight) {
    return panelY + panelHeight + WINDOW_TOUCH_SAMPLE_INSET;
}
