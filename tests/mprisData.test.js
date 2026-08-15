import {extractMetadata, parseMediaState} from '../lib/mprisData.js';

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// extractMetadata
{
    const result = extractMetadata({
        'xesam:title': 'Besties',
        'xesam:artist': ['Black Country, New Road'],
        'mpris:artUrl': 'https://example.com/art.jpg',
    });
    assertEqual(result, {title: 'Besties', artist: 'Black Country, New Road', artUrl: 'https://example.com/art.jpg'},
        'extractMetadata: full metadata');
}

{
    const result = extractMetadata({});
    assertEqual(result, {title: null, artist: null, artUrl: null}, 'extractMetadata: empty metadata');
}

{
    const result = extractMetadata({'xesam:artist': []});
    assertEqual(result.artist, null, 'extractMetadata: empty artist array is null, not undefined');
}

// parseMediaState: idle
{
    const result = parseMediaState({
        title: null, artist: null, artUrl: null, playbackStatus: null,
        canGoNext: false, canGoPrevious: false, canPlay: false, canPause: false,
    });
    assertEqual(result.isActive, false, 'idle: not active');
    assertEqual(result.isPlaying, false, 'idle: not playing');
    assertEqual(result.title, '', 'idle: title defaults to empty string');
}

// parseMediaState: playing, can pause but not resume-from-pause distinction
{
    const result = parseMediaState({
        title: 'Besties', artist: 'Black Country, New Road', artUrl: null, playbackStatus: 'Playing',
        canGoNext: true, canGoPrevious: false, canPlay: false, canPause: true,
    });
    assertEqual(result.isActive, true, 'playing: active');
    assertEqual(result.isPlaying, true, 'playing: isPlaying true');
    assertEqual(result.canTogglePlayback, true, 'playing: can pause, so playback is togglable');
    assertEqual(result.canGoNext, true, 'playing: canGoNext passed through');
    assertEqual(result.canGoPrevious, false, 'playing: canGoPrevious passed through');
}

// parseMediaState: paused, cannot resume
{
    const result = parseMediaState({
        title: 'Besties', artist: 'Black Country, New Road', artUrl: null, playbackStatus: 'Paused',
        canGoNext: true, canGoPrevious: true, canPlay: false, canPause: true,
    });
    assertEqual(result.isActive, true, 'paused: still active');
    assertEqual(result.isPlaying, false, 'paused: isPlaying false');
    assertEqual(result.canTogglePlayback, false, 'paused: canPlay is false, so playback is not togglable');
}

// parseMediaState: stopped is not active
{
    const result = parseMediaState({
        title: 'Besties', artist: null, artUrl: null, playbackStatus: 'Stopped',
        canGoNext: false, canGoPrevious: false, canPlay: true, canPause: false,
    });
    assertEqual(result.isActive, false, 'stopped: not active');
}

print('All mprisData tests passed.');
