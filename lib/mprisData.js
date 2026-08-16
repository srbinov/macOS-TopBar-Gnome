/** @param {{'xesam:title'?: string, 'xesam:artist'?: string[]|string, 'mpris:artUrl'?: string}} metadata */
export function extractMetadata(metadata) {
    const artistRaw = metadata['xesam:artist'];
    let artist = null;
    if (Array.isArray(artistRaw) && artistRaw.length > 0)
        artist = String(artistRaw[0]);
    else if (typeof artistRaw === 'string' && artistRaw.length > 0)
        artist = artistRaw;

    const title = metadata['xesam:title'];
    const artUrl = metadata['mpris:artUrl'];

    return {
        // Coerce so St.Label.text never receives a leftover GLib.Variant.
        title: title != null && title !== '' ? String(title) : null,
        artist,
        artUrl: artUrl != null && artUrl !== '' ? String(artUrl) : null,
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
