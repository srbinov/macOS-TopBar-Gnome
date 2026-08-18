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

// formatMacTime — options
assertEqual(
    formatMacTime(new Date(2026, 7, 5, 9, 7), {use24Hour: true}), '09:07', 'formatMacTime: 24-hour zero-padded');
assertEqual(
    formatMacTime(new Date(2026, 7, 5, 0, 0), {use24Hour: true}), '00:00', 'formatMacTime: 24-hour midnight');
assertEqual(
    formatMacTime(new Date(2026, 7, 5, 13, 5), {use24Hour: true}), '13:05', 'formatMacTime: 24-hour afternoon');
assertEqual(
    formatMacTime(new Date(2026, 7, 5, 9, 7, 3), {showSeconds: true}), '9:07:03 AM',
    'formatMacTime: 12-hour with seconds');
assertEqual(
    formatMacTime(new Date(2026, 7, 5, 13, 5, 45), {use24Hour: true, showSeconds: true}), '13:05:45',
    'formatMacTime: 24-hour with seconds');

print('All clockFormat tests passed.');
