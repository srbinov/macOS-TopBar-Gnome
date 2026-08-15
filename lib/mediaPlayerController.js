// lib/mediaPlayerController.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {extractMetadata, parseMediaState} from './mprisData.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

export class MediaPlayerController {
    constructor(onChange) {
        this._onChange = onChange;
        this._players = new Map(); // busName -> {proxy, propsChangedId, lastActive}
        this._artCache = new Map(); // artUrl -> Gio.Icon
        this._soupSession = new Soup.Session();
        this._selectedBusName = null;
        this._isDestroyed = false;

        this._discoverExistingPlayers();
        this._watchForNewPlayers();
        this._emitIdle();
    }

    _discoverExistingPlayers() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null,
            (source, result) => {
                try {
                    const reply = source.call_finish(result);
                    if (this._isDestroyed)
                        return;
                    const [names] = reply.deep_unpack();
                    names.filter(name => name.startsWith(MPRIS_PREFIX)).forEach(name => this._trackPlayer(name));
                } catch (e) {
                    logError(e, '[macos-top-panel] control center: failed to list MPRIS players');
                }
            });
    }

    _watchForNewPlayers() {
        this._nameOwnerChangedId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            null, Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner)
                    this._trackPlayer(name);
                else
                    this._untrackPlayer(name);
            });
    }

    _trackPlayer(busName) {
        if (this._players.has(busName) || this._isDestroyed)
            return;

        this._players.set(busName, {proxy: null, propsChangedId: 0, lastActive: 0});

        Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
            busName, '/org/mpris/MediaPlayer2', PLAYER_IFACE, null,
            (source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    const entry = this._players.get(busName);
                    if (this._isDestroyed || !entry)
                        return;
                    entry.proxy = proxy;
                    entry.propsChangedId = proxy.connect('g-properties-changed', () => this._onPlayerChanged(busName));
                    this._onPlayerChanged(busName);
                } catch (e) {
                    logError(e, `[macos-top-panel] control center: failed to connect to MPRIS player ${busName}`);
                }
            });
    }

    _untrackPlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;
        if (entry.proxy && entry.propsChangedId)
            entry.proxy.disconnect(entry.propsChangedId);
        this._players.delete(busName);
        this._recompute();
    }

    _onPlayerChanged(busName) {
        const entry = this._players.get(busName);
        if (!entry || !entry.proxy)
            return;
        entry.lastActive = GLib.get_monotonic_time();
        this._recompute();
    }

    _recompute() {
        let selectedName = null;
        let selectedEntry = null;

        for (const [name, entry] of this._players.entries()) {
            if (!entry.proxy)
                continue;
            const status = entry.proxy.get_cached_property('PlaybackStatus')?.unpack();
            if (status !== 'Playing' && status !== 'Paused')
                continue;
            if (!selectedEntry || entry.lastActive > selectedEntry.lastActive) {
                selectedEntry = entry;
                selectedName = name;
            }
        }

        this._selectedBusName = selectedName;

        if (!selectedEntry) {
            this._emitIdle();
            return;
        }

        const proxy = selectedEntry.proxy;
        const metadataVariant = proxy.get_cached_property('Metadata');
        const rawMetadata = metadataVariant ? metadataVariant.deep_unpack() : {};
        const unpackedMetadata = {};
        for (const [key, value] of Object.entries(rawMetadata))
            unpackedMetadata[key] = value.unpack();

        const {title, artist, artUrl} = extractMetadata(unpackedMetadata);

        const state = parseMediaState({
            title, artist, artUrl,
            playbackStatus: proxy.get_cached_property('PlaybackStatus')?.unpack() ?? null,
            canGoNext: proxy.get_cached_property('CanGoNext')?.unpack() ?? false,
            canGoPrevious: proxy.get_cached_property('CanGoPrevious')?.unpack() ?? false,
            canPlay: proxy.get_cached_property('CanPlay')?.unpack() ?? false,
            canPause: proxy.get_cached_property('CanPause')?.unpack() ?? false,
        });

        this._onChange({...state, artIcon: artUrl ? (this._artCache.get(artUrl) ?? null) : null});

        if (artUrl && !this._artCache.has(artUrl))
            this._loadArt(artUrl, state);
    }

    _emitIdle() {
        const state = parseMediaState({
            title: null, artist: null, artUrl: null, playbackStatus: null,
            canGoNext: false, canGoPrevious: false, canPlay: false, canPause: false,
        });
        this._onChange({...state, artIcon: null});
    }

    _loadArt(url, stateSnapshot) {
        if (url.startsWith('file://')) {
            const icon = Gio.icon_new_for_string(url);
            this._artCache.set(url, icon);
            if (this._selectedBusName)
                this._onChange({...stateSnapshot, artIcon: icon});
            return;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://'))
            return;

        const message = Soup.Message.new('GET', url);
        this._soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                const bytes = source.send_and_read_finish(result);
                if (this._isDestroyed || message.get_status() !== Soup.Status.OK)
                    return;
                const icon = Gio.BytesIcon.new(bytes);
                this._artCache.set(url, icon);
                this._onChange({...stateSnapshot, artIcon: icon});
            } catch (e) {
                logError(e, `[macos-top-panel] control center: failed to fetch media art from ${url}`);
            }
        });
    }

    previous() {
        this._callPlayerMethod('Previous');
    }

    next() {
        this._callPlayerMethod('Next');
    }

    playPause() {
        this._callPlayerMethod('PlayPause');
    }

    _callPlayerMethod(method) {
        const entry = this._selectedBusName ? this._players.get(this._selectedBusName) : null;
        if (!entry?.proxy)
            return;
        entry.proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
            try {
                source.call_finish(result);
            } catch (e) {
                logError(e, `[macos-top-panel] control center: MPRIS ${method} failed`);
            }
        });
    }

    destroy() {
        this._isDestroyed = true;
        if (this._nameOwnerChangedId)
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerChangedId);
        this._soupSession.abort();
        for (const entry of this._players.values()) {
            if (entry.proxy && entry.propsChangedId)
                entry.proxy.disconnect(entry.propsChangedId);
        }
        this._players.clear();
    }
}
