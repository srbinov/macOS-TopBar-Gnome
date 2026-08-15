/** @param {{raw: number, max: number}} props */
export function rawToPercent(props) {
    if (props.max <= 0)
        return 0;
    return Math.max(0, Math.min(100, Math.round((props.raw / props.max) * 100)));
}

/** @param {{percent: number, max: number}} props */
export function percentToRaw(props) {
    const clampedPercent = Math.max(0, Math.min(100, props.percent));
    return Math.round((clampedPercent / 100) * props.max);
}
