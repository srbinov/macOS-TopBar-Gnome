// lib/brightnessController.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {rawToPercent, percentToRaw} from './brightnessData.js';

const BACKLIGHT_DIR = '/sys/class/backlight';

export class BrightnessController {
    constructor(onChange) {
        this._onChange = onChange;
        this._device = null;
        this._max = 0;
        this._monitor = null;
        this._monitorSignalId = 0;
        this._sessionPath = null;
        this._isDestroyed = false;

        this._findDevice();
        this._resolveSession();
    }

    _findDevice() {
        try {
            const dir = Gio.File.new_for_path(BACKLIGHT_DIR);
            const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            const info = children.next_file(null);
            children.close(null);
            if (!info)
                return;

            this._device = info.get_name();

            const maxFile = Gio.File.new_for_path(GLib.build_filenamev([BACKLIGHT_DIR, this._device, 'max_brightness']));
            const [, maxContents] = maxFile.load_contents(null);
            this._max = parseInt(new TextDecoder().decode(maxContents).trim(), 10) || 0;

            const brightnessFile = Gio.File.new_for_path(GLib.build_filenamev([BACKLIGHT_DIR, this._device, 'brightness']));
            this._monitor = brightnessFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorSignalId = this._monitor.connect('changed', () => this._readBrightness());
            this._readBrightness();
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to find a backlight device');
        }
    }

    _readBrightness() {
        if (!this._device || this._isDestroyed)
            return;
        try {
            const brightnessFile = Gio.File.new_for_path(GLib.build_filenamev([BACKLIGHT_DIR, this._device, 'brightness']));
            const [, contents] = brightnessFile.load_contents(null);
            const raw = parseInt(new TextDecoder().decode(contents).trim(), 10) || 0;
            this._onChange({percent: rawToPercent({raw, max: this._max})});
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to read screen brightness');
        }
    }

    _resolveSession() {
        // GNOME Shell runs as a systemd user service (org.gnome.Shell@user.service),
        // not inside the login session's own cgroup scope, so
        // Manager.GetSessionByPID can't trace it back to a session. Resolve the
        // seat's active session instead, which doesn't depend on cgroup membership.
        Gio.DBus.system.call(
            'org.freedesktop.login1', '/org/freedesktop/login1/seat/seat0',
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.freedesktop.login1.Seat', 'ActiveSession']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (source, result) => {
                try {
                    const reply = source.call_finish(result);
                    if (this._isDestroyed)
                        return;
                    const [variant] = reply.deep_unpack();
                    const [, sessionPath] = variant.deep_unpack();
                    this._sessionPath = sessionPath;
                } catch (e) {
                    logError(e, '[macos-top-panel] control center: failed to resolve the active login session');
                }
            });
    }

    setPercent(percent) {
        if (!this._device || !this._sessionPath || this._max <= 0)
            return;
        const raw = percentToRaw({percent, max: this._max});
        try {
            Gio.DBus.system.call_sync(
                'org.freedesktop.login1', this._sessionPath, 'org.freedesktop.login1.Session', 'SetBrightness',
                new GLib.Variant('(ssu)', ['backlight', this._device, raw]),
                null, Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to set screen brightness');
        }
    }

    destroy() {
        this._isDestroyed = true;
        if (this._monitor && this._monitorSignalId)
            this._monitor.disconnect(this._monitorSignalId);
        this._monitor = null;
    }
}
