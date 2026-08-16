import {
    relativeLuminance,
    foregroundForBackground,
    formatRgb,
    formatRgba,
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

print('All colorUtil tests passed.');
