import {formatMacDate, formatMacTime} from '../lib/clockFormat.js';

function assertEqual(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`FAIL: ${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
    print(`PASS: ${msg}`);
}

// formatMacDate
assertEqual(formatMacDate(new Date(2026, 7, 5)), 'Wed Aug 5', 'formatMacDate: Wed Aug 5 2026');
assertEqual(formatMacDate(new Date(2026, 0, 1)), 'Thu Jan 1', 'formatMacDate: Thu Jan 1 2026');
assertEqual(formatMacDate(new Date(2026, 11, 25)), 'Fri Dec 25', 'formatMacDate: Fri Dec 25 2026');

// formatMacTime — 12-hour, no leading zero on hour, minute zero-padded, AM/PM
assertEqual(formatMacTime(new Date(2026, 7, 5, 0, 0)), '12:00 AM', 'formatMacTime: midnight');
assertEqual(formatMacTime(new Date(2026, 7, 5, 12, 0)), '12:00 PM', 'formatMacTime: noon');
assertEqual(formatMacTime(new Date(2026, 7, 5, 13, 5)), '1:05 PM', 'formatMacTime: 1:05 PM padded minute');
assertEqual(formatMacTime(new Date(2026, 7, 5, 9, 7)), '9:07 AM', 'formatMacTime: 9:07 AM');
assertEqual(formatMacTime(new Date(2026, 7, 5, 23, 59)), '11:59 PM', 'formatMacTime: 11:59 PM');

print('All clockFormat tests passed.');
