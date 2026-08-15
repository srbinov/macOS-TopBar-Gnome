import {rawToPercent, percentToRaw} from '../lib/brightnessData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

assertEqual(rawToPercent({raw: 0, max: 96000}), 0, 'rawToPercent: zero');
assertEqual(rawToPercent({raw: 96000, max: 96000}), 100, 'rawToPercent: full');
assertEqual(rawToPercent({raw: 48000, max: 96000}), 50, 'rawToPercent: half');
assertEqual(rawToPercent({raw: 52609, max: 96000}), 55, 'rawToPercent: rounds to nearest percent');
assertEqual(rawToPercent({raw: 0, max: 0}), 0, 'rawToPercent: zero max does not divide by zero');
assertEqual(rawToPercent({raw: 999999, max: 96000}), 100, 'rawToPercent: clamps above 100');

assertEqual(percentToRaw({percent: 0, max: 96000}), 0, 'percentToRaw: zero');
assertEqual(percentToRaw({percent: 100, max: 96000}), 96000, 'percentToRaw: full');
assertEqual(percentToRaw({percent: 50, max: 96000}), 48000, 'percentToRaw: half');
assertEqual(percentToRaw({percent: 150, max: 96000}), 96000, 'percentToRaw: clamps above 100');
assertEqual(percentToRaw({percent: -10, max: 96000}), 0, 'percentToRaw: clamps below 0');

print('All brightnessData tests passed.');
