import {parseWifiState} from '../lib/wifiData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// wifi off
{
    const result = parseWifiState({wirelessEnabled: false, ssid: null, strength: null});
    assertEqual(result.enabled, false, 'off: enabled false');
    assertEqual(result.connected, false, 'off: connected false');
    assertEqual(result.statusLabel, 'Wi-Fi Off', 'off: statusLabel');
}

// on, not connected
{
    const result = parseWifiState({wirelessEnabled: true, ssid: null, strength: null});
    assertEqual(result.enabled, true, 'on/disconnected: enabled true');
    assertEqual(result.connected, false, 'on/disconnected: connected false');
    assertEqual(result.statusLabel, 'Not Connected', 'on/disconnected: statusLabel');
}

// connected, excellent signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 85});
    assertEqual(result.connected, true, 'connected: connected true');
    assertEqual(result.ssid, 'Archer50', 'connected: ssid');
    assertEqual(result.statusLabel, 'Archer50 (Excellent)', 'connected: excellent signal label');
}

// connected, good signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 63});
    assertEqual(result.statusLabel, 'Archer50 (Good)', 'connected: good signal label');
}

// connected, fair signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 35});
    assertEqual(result.statusLabel, 'Archer50 (Fair)', 'connected: fair signal label');
}

// connected, weak signal
{
    const result = parseWifiState({wirelessEnabled: true, ssid: 'Archer50', strength: 10});
    assertEqual(result.statusLabel, 'Archer50 (Weak)', 'connected: weak signal label');
}

print('All wifiData tests passed.');
