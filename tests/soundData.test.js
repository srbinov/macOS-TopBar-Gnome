import {parseSoundState} from '../lib/soundData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// explicitly muted
{
    const result = parseSoundState({muted: true, volume: 40, maxVolume: 100});
    assertEqual(result.muted, true, 'muted: muted true');
    assertEqual(result.icon, 'audio-volume-muted-symbolic', 'muted: icon');
    assertEqual(result.statusLabel, 'Muted', 'muted: statusLabel');
}

// unmuted but volume at zero counts as muted
{
    const result = parseSoundState({muted: false, volume: 0, maxVolume: 100});
    assertEqual(result.muted, true, 'zero volume: muted true');
    assertEqual(result.percentage, 0, 'zero volume: percentage 0');
}

// low volume
{
    const result = parseSoundState({muted: false, volume: 20, maxVolume: 100});
    assertEqual(result.muted, false, 'low volume: muted false');
    assertEqual(result.percentage, 20, 'low volume: percentage');
    assertEqual(result.icon, 'audio-volume-low-symbolic', 'low volume: icon');
    assertEqual(result.statusLabel, '20%', 'low volume: statusLabel');
}

// medium volume
{
    const result = parseSoundState({muted: false, volume: 50, maxVolume: 100});
    assertEqual(result.icon, 'audio-volume-medium-symbolic', 'medium volume: icon');
}

// high volume
{
    const result = parseSoundState({muted: false, volume: 90, maxVolume: 100});
    assertEqual(result.icon, 'audio-volume-high-symbolic', 'high volume: icon');
    assertEqual(result.statusLabel, '90%', 'high volume: statusLabel');
}

// boundary: exactly 33% is medium, exactly 67% is high
{
    assertEqual(parseSoundState({muted: false, volume: 33, maxVolume: 100}).icon,
        'audio-volume-medium-symbolic', 'boundary 33%: medium');
    assertEqual(parseSoundState({muted: false, volume: 67, maxVolume: 100}).icon,
        'audio-volume-high-symbolic', 'boundary 67%: high');
}

// rounds to nearest integer percentage
{
    const result = parseSoundState({muted: false, volume: 1, maxVolume: 3});
    assertEqual(result.percentage, 33, 'rounds: 1/3 -> 33%');
}

print('All soundData tests passed.');
