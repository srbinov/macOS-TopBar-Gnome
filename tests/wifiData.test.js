import {parseWifiState, buildNetworkList, signalIconName} from '../lib/wifiData.js';

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

// signalIconName thresholds
{
    assertEqual(signalIconName(85), 'network-wireless-signal-excellent-symbolic', 'icon: excellent');
    assertEqual(signalIconName(60), 'network-wireless-signal-good-symbolic', 'icon: good');
    assertEqual(signalIconName(35), 'network-wireless-signal-ok-symbolic', 'icon: ok');
    assertEqual(signalIconName(10), 'network-wireless-signal-weak-symbolic', 'icon: weak');
    assertEqual(signalIconName(0), 'network-wireless-signal-none-symbolic', 'icon: none');
}

// buildNetworkList: dedupes repeated SSIDs, keeping the strongest
{
    const result = buildNetworkList([
        {ssid: 'Cafe', strength: 40, secured: true},
        {ssid: 'Cafe', strength: 70, secured: true},
        {ssid: 'Home', strength: 90, secured: true},
    ], null);
    assertEqual(result.length, 2, 'dedupe: two unique SSIDs');
    assertEqual(result[0].ssid, 'Home', 'dedupe: strongest network sorts first');
    assertEqual(result[1].strength, 70, 'dedupe: kept the stronger Cafe reading');
}

// buildNetworkList: hidden (null-ssid) networks are dropped
{
    const result = buildNetworkList([
        {ssid: null, strength: 99, secured: true},
        {ssid: 'Visible', strength: 50, secured: false},
    ], null);
    assertEqual(result.length, 1, 'hidden network dropped');
    assertEqual(result[0].ssid, 'Visible', 'only the named network remains');
}

// buildNetworkList: connected network sorts first regardless of signal
{
    const result = buildNetworkList([
        {ssid: 'Strong', strength: 95, secured: false},
        {ssid: 'MyNetwork', strength: 20, secured: true},
    ], 'MyNetwork');
    assertEqual(result[0].ssid, 'MyNetwork', 'connected network pinned first');
    assertEqual(result[0].connected, true, 'connected flag set on the active network');
    assertEqual(result[1].connected, false, 'connected flag false on everything else');
}

print('All wifiData tests passed.');
