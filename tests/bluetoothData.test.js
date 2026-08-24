import {parseBluetoothState, sortBluetoothDevices} from '../lib/bluetoothData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// powered off
{
    const result = parseBluetoothState({powered: false, connectedDeviceName: null});
    assertEqual(result.powered, false, 'off: powered false');
    assertEqual(result.connectedDeviceName, null, 'off: no device even if one was passed');
    assertEqual(result.statusLabel, 'Bluetooth Off', 'off: statusLabel');
}

// powered off, device name passed anyway (should still be null)
{
    const result = parseBluetoothState({powered: false, connectedDeviceName: 'AirPods'});
    assertEqual(result.connectedDeviceName, null, 'off: device name ignored while powered off');
}

// powered on, nothing connected
{
    const result = parseBluetoothState({powered: true, connectedDeviceName: null});
    assertEqual(result.powered, true, 'on/disconnected: powered true');
    assertEqual(result.statusLabel, 'Not Connected', 'on/disconnected: statusLabel');
}

// powered on, device connected
{
    const result = parseBluetoothState({powered: true, connectedDeviceName: 'AirPods'});
    assertEqual(result.connectedDeviceName, 'AirPods', 'connected: device name');
    assertEqual(result.statusLabel, 'AirPods', 'connected: statusLabel is the device name');
}

// sortBluetoothDevices: connected first, then paired, then discovered-only; alpha within group
{
    const result = sortBluetoothDevices([
        {path: '/a', name: 'Zebra Speaker', connected: false, paired: true},
        {path: '/b', name: 'AirPods', connected: true, paired: true},
        {path: '/c', name: 'Random Scanner', connected: false, paired: false},
        {path: '/d', name: 'Apple Mouse', connected: false, paired: true},
    ]);
    assertEqual(result.map(d => d.name), ['AirPods', 'Apple Mouse', 'Zebra Speaker', 'Random Scanner'],
        'connected first, then paired alphabetically, then discovered-only');
}

// sortBluetoothDevices: unnamed devices sort last within their group
{
    const result = sortBluetoothDevices([
        {path: '/a', name: null, connected: false, paired: true},
        {path: '/b', name: 'Keyboard', connected: false, paired: true},
    ]);
    assertEqual(result.map(d => d.name), ['Keyboard', null], 'unnamed device sorts after named ones');
}

print('All bluetoothData tests passed.');
