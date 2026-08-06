/**
 * @param {{muted: boolean, volume: number, maxVolume: number}} props
 */
export function parseSoundState(props) {
    const percentage = props.maxVolume > 0
        ? Math.round((props.volume / props.maxVolume) * 100)
        : 0;
    const muted = props.muted || percentage <= 0;

    let icon;
    if (muted)
        icon = 'audio-volume-muted-symbolic';
    else if (percentage < 33)
        icon = 'audio-volume-low-symbolic';
    else if (percentage < 67)
        icon = 'audio-volume-medium-symbolic';
    else
        icon = 'audio-volume-high-symbolic';

    const statusLabel = muted ? 'Muted' : `${percentage}%`;

    return {muted, percentage, icon, statusLabel};
}
