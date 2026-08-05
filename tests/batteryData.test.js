import {parseBatteryState, formatDuration} from '../lib/batteryData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// formatDuration
assertEqual(formatDuration(5446), '1:31', 'formatDuration: 5446s -> 1:31');
assertEqual(formatDuration(60), '0:01', 'formatDuration: 60s -> 0:01');
assertEqual(formatDuration(0), '0:00', 'formatDuration: 0s -> 0:00');

// no battery present -> hasBattery false, rest of the fields don't matter
{
    const result = parseBatteryState({isPresent: false, percentage: 0, state: 0, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.hasBattery, false, 'no battery: hasBattery false');
}

// charging with a known time-to-full
{
    const result = parseBatteryState({isPresent: true, percentage: 18, state: 1, timeToEmpty: 0, timeToFull: 5446});
    assertEqual(result.hasBattery, true, 'charging: hasBattery true');
    assertEqual(result.charging, true, 'charging: charging true');
    assertEqual(result.percentage, 18, 'charging: percentage 18');
    assertEqual(result.statusLabel, '18% (1:31 until full)', 'charging: statusLabel with time-to-full');
}

// discharging with a known time-to-empty
{
    const result = parseBatteryState({isPresent: true, percentage: 64, state: 2, timeToEmpty: 3600, timeToFull: 0});
    assertEqual(result.charging, false, 'discharging: charging false');
    assertEqual(result.statusLabel, '64% (1:00 remaining)', 'discharging: statusLabel with time-to-empty');
}

// fully charged
{
    const result = parseBatteryState({isPresent: true, percentage: 100, state: 4, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.charging, false, 'fully charged: charging false');
    assertEqual(result.statusLabel, '100% (Fully Charged)', 'fully charged: statusLabel');
}

// discharging with no time estimate available yet
{
    const result = parseBatteryState({isPresent: true, percentage: 47, state: 2, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.statusLabel, '47%', 'discharging, no estimate: statusLabel is bare percentage');
}

// percentage gets rounded
{
    const result = parseBatteryState({isPresent: true, percentage: 63.7, state: 2, timeToEmpty: 0, timeToFull: 0});
    assertEqual(result.percentage, 64, 'percentage rounds to nearest integer');
}

print('All batteryData tests passed.');
