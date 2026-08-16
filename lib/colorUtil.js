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
