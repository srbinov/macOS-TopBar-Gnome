/** @param {number} strength 0-100 */
function strengthLabel(strength) {
    if (strength >= 80)
        return 'Excellent';
    if (strength >= 55)
        return 'Good';
    if (strength >= 30)
        return 'Fair';
    return 'Weak';
}

/**
 * @param {{wirelessEnabled: boolean, ssid: string|null, strength: number|null}} props
 */
export function parseWifiState(props) {
    const enabled = props.wirelessEnabled;
    const connected = enabled && props.ssid != null;

    let statusLabel;
    if (!enabled)
        statusLabel = 'Wi-Fi Off';
    else if (!connected)
        statusLabel = 'Not Connected';
    else
        statusLabel = `${props.ssid} (${strengthLabel(props.strength)})`;

    return {enabled, connected, ssid: props.ssid, strength: props.strength, statusLabel};
}
