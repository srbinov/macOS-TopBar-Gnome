import {
    relativeLuminance,
    foregroundForBackground,
    formatRgb,
    formatRgba,
    windowTouchFill,
    windowTouchSampleY,
} from '../lib/colorUtil.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

function assertTrue(cond, msg) {
    if (!cond)
        throw new Error(`FAIL: ${msg}`);
    print(`PASS: ${msg}`);
}

assertTrue(relativeLuminance(255, 255, 255) > 0.9, 'white is high luminance');
assertTrue(relativeLuminance(0, 0, 0) < 0.05, 'black is low luminance');
assertTrue(relativeLuminance(255, 255, 255) > relativeLuminance(128, 128, 128), 'white > mid gray');

assertEqual(foregroundForBackground(255, 255, 255), 'black', 'light wallpaper → black chrome');
assertEqual(foregroundForBackground(240, 240, 240), 'black', 'near-white → black chrome');
assertEqual(foregroundForBackground(0, 0, 0), 'white', 'dark wallpaper → white chrome');
assertEqual(foregroundForBackground(20, 24, 40), 'white', 'dark blue wallpaper → white chrome');

assertEqual(formatRgb({r: 10, g: 20, b: 30}), 'rgb(10, 20, 30)', 'formatRgb');
assertEqual(formatRgba({r: 1, g: 2, b: 3, a: 0.5}), 'rgba(1, 2, 3, 0.5)', 'formatRgba with alpha');
assertEqual(formatRgba({r: 1, g: 2, b: 3}), 'rgba(1, 2, 3, 1)', 'formatRgba default alpha');

// windowTouchFill/windowTouchSampleY: guards against the fill silently regressing back to
// a translucent rgba() (mixes wallpaper into the sampled window color) or the sample point
// regressing back to the seam (panelBottom + 1, which reads as the window's own CSD
// border/shadow instead of its real chrome color) -- see their docstrings in colorUtil.js.
assertEqual(windowTouchFill(45, 45, 48), 'rgb(45, 45, 48)', 'window touch fill is opaque charcoal');
assertEqual(windowTouchFill(12.4, 40.6, 90.2), 'rgb(12, 41, 90)', 'window touch fill rounds channels');
assertEqual(windowTouchSampleY(0, 32), 40, 'sample 8px below a 32px panel');
assertEqual(windowTouchSampleY(48, 40), 96, 'sample accounts for panel y origin');

print('All colorUtil tests passed.');
