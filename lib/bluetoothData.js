/** @param {{powered: boolean, connectedDeviceName: string|null}} props */
export function parseBluetoothState(props) {
    const powered = props.powered;
    const connectedDeviceName = powered ? (props.connectedDeviceName ?? null) : null;

    let statusLabel;
    if (!powered)
        statusLabel = 'Bluetooth Off';
    else if (connectedDeviceName)
        statusLabel = connectedDeviceName;
    else
        statusLabel = 'Not Connected';

    return {powered, connectedDeviceName, statusLabel};
}

/**
 * Sort BlueZ devices for display: connected first, then other paired
 * devices, then everything else merely discovered by a scan -- each group
 * alphabetical by name. Unnamed devices (bare MAC, no name/alias reported
 * yet) sort last within their group rather than cluttering the top under
 * whatever locale-dependent order a raw MAC string would fall into.
 *
 * @param {{path: string, name: string|null, connected: boolean, paired: boolean}[]} devices
 */
export function sortBluetoothDevices(devices) {
    const rank = d => (d.connected ? 0 : d.paired ? 1 : 2);
    return [...devices].sort((a, b) => {
        const rankDiff = rank(a) - rank(b);
        if (rankDiff !== 0)
            return rankDiff;
        if (!a.name !== !b.name)
            return a.name ? -1 : 1;
        return (a.name ?? '').localeCompare(b.name ?? '');
    });
}
