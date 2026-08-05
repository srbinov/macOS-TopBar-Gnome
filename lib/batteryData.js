const DeviceState = {
    UNKNOWN: 0,
    CHARGING: 1,
    DISCHARGING: 2,
    EMPTY: 3,
    FULLY_CHARGED: 4,
    PENDING_CHARGE: 5,
    PENDING_DISCHARGE: 6,
};

/** @param {number} seconds */
export function formatDuration(seconds) {
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * @param {{isPresent: boolean, percentage: number, state: number, timeToEmpty: number, timeToFull: number}} props
 */
export function parseBatteryState(props) {
    const hasBattery = props.isPresent;
    const percentage = Math.round(props.percentage);
    const charging = props.state === DeviceState.CHARGING || props.state === DeviceState.PENDING_CHARGE;

    let statusLabel;
    if (props.state === DeviceState.FULLY_CHARGED) {
        statusLabel = `${percentage}% (Fully Charged)`;
    } else if (charging) {
        statusLabel = props.timeToFull > 0
            ? `${percentage}% (${formatDuration(props.timeToFull)} until full)`
            : `${percentage}% (Charging)`;
    } else if (props.state === DeviceState.DISCHARGING && props.timeToEmpty > 0) {
        statusLabel = `${percentage}% (${formatDuration(props.timeToEmpty)} remaining)`;
    } else {
        statusLabel = `${percentage}%`;
    }

    return {hasBattery, percentage, charging, statusLabel};
}
