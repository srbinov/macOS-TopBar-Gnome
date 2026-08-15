/** @param {{'xesam:title'?: string, 'xesam:artist'?: string[], 'mpris:artUrl'?: string}} metadata */
export function extractMetadata(metadata) {
    const artistList = metadata['xesam:artist'];
    const artist = Array.isArray(artistList) && artistList.length > 0 ? artistList[0] : null;

    return {
        title: metadata['xesam:title'] ?? null,
        artist,
        artUrl: metadata['mpris:artUrl'] ?? null,
    };
}

/**
 * @param {{title: string|null, artist: string|null, artUrl: string|null, playbackStatus: string|null,
 *   canGoNext: boolean, canGoPrevious: boolean, canPlay: boolean, canPause: boolean}} props
 */
export function parseMediaState(props) {
    const isPlaying = props.playbackStatus === 'Playing';
    const isActive = isPlaying || props.playbackStatus === 'Paused';

    return {
        isActive,
        isPlaying,
        title: props.title ?? '',
        artist: props.artist ?? '',
        artUrl: props.artUrl ?? null,
        canGoNext: Boolean(props.canGoNext),
        canGoPrevious: Boolean(props.canGoPrevious),
        canTogglePlayback: isPlaying ? Boolean(props.canPause) : Boolean(props.canPlay),
    };
}
