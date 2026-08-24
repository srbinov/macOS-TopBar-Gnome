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

/** @param {number} strength 0-100 */
export function signalIconName(strength) {
    if (strength >= 80)
        return 'network-wireless-signal-excellent-symbolic';
    if (strength >= 55)
        return 'network-wireless-signal-good-symbolic';
    if (strength >= 30)
        return 'network-wireless-signal-ok-symbolic';
    if (strength > 0)
        return 'network-wireless-signal-weak-symbolic';
    return 'network-wireless-signal-none-symbolic';
}

/**
 * Dedupe raw scan results down to one row per SSID (keeping the strongest of
 * any repeats -- the same network's multiple access points/bands show up as
 * separate scan results), sorted connected-first then strongest-first, with
 * `connected` flagging whichever row matches the currently active SSID.
 *
 * @param {{ssid: string|null, strength: number, secured: boolean}[]} rawAps
 * @param {string|null} activeSsid
 */
export function buildNetworkList(rawAps, activeSsid) {
    const bySsid = new Map();
    for (const ap of rawAps) {
        if (!ap.ssid)
            continue; // hidden network -- no name to show or key on
        const existing = bySsid.get(ap.ssid);
        if (!existing || ap.strength > existing.strength)
            bySsid.set(ap.ssid, ap);
    }

    return [...bySsid.values()]
        .map(ap => ({...ap, connected: activeSsid != null && ap.ssid === activeSsid}))
        .sort((a, b) => {
            if (a.connected !== b.connected)
                return a.connected ? -1 : 1;
            return b.strength - a.strength;
        });
}
