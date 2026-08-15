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
