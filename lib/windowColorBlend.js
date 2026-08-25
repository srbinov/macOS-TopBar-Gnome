/*
 * Watches for windows touching the top of the screen and reports:
 *   - blendColor: sampled rgb() while a window touches the panel strip; null otherwise
 *   - foreground: 'black' | 'white' from luminance of the sampled pixel
 *     (wallpaper under a transparent panel, or window chrome when blending)
 *
 * `pick_color()` samples the actual composited screen pixel.
 *
 * Cogl.Color's red/green/blue fields are UINT8 (0-255).
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {foregroundForBackground, windowTouchFill, windowTouchSampleY} from './colorUtil.js';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

const DEBOUNCE_MS = 300;
const SETTLE_RECHECK_MS = 500;

/**
 * @param {() => {x: number, y: number, width: number, height: number}} getPanelRect
 * @param {(state: {blendColor: string|null, foreground: 'black'|'white'}) => void} onChange
 */
export class WindowColorBlend {
    constructor(getPanelRect, onChange) {
        this._getPanelRect = getPanelRect;
        this._onChange = onChange;
        this._signalIds = [];
        this._timeoutId = 0;
        this._isDestroyed = false;
        this._bgSettings = null;
        this._lastBlendColor = undefined;
        this._lastForeground = undefined;
    }

    enable() {
        // Reversible: this can now be disabled and re-enabled by the
        // window-color-blend-enabled setting toggle (see extension.js's
        // _syncWindowColorBlend()), not just once at extension enable()/disable(). Without
        // this guard, a second enable() after disable() left _isDestroyed true forever --
        // every _check() bails at its own top-of-function guard, so the toggle would look
        // like it does nothing on re-enable.
        if (this._signalIds.length)
            return; // already enabled
        this._isDestroyed = false;
        // Force the next _check() to actually fire onChange even if it resamples the exact
        // same pixel as before disable() -- otherwise the early-return dedupe below would
        // suppress the very update that's supposed to bring the bar back.
        this._lastBlendColor = undefined;
        this._lastForeground = undefined;

        const wm = global.window_manager;
        this._signalIds.push([wm, wm.connect('size-change', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('minimize', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('unminimize', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('map', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('destroy', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('switch-workspace', () => this._scheduleCheck())]);
        this._signalIds.push([global.display,
            global.display.connect('window-created', () => this._scheduleCheck())]);

        try {
            this._bgSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            this._signalIds.push([this._bgSettings,
                this._bgSettings.connect('changed', () => this._scheduleCheck())]);
        } catch (e) {
            logError(e, '[macos-top-panel] failed to watch desktop background settings');
            this._bgSettings = null;
        }

        this._scheduleCheck();
    }

    disable() {
        this._isDestroyed = true;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        for (const [obj, id] of this._signalIds)
            obj.disconnect(id);
        this._signalIds = [];
        this._bgSettings = null;
    }

    _scheduleCheck() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._timeoutId = 0;
            this._check().catch(e => logError(e, '[macos-top-panel] window color blend check failed'));
            return GLib.SOURCE_REMOVE;
        });
    }

    _findTouchingWindow(panelRect) {
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().find(win => {
            if (win.minimized || win.get_window_type() !== Meta.WindowType.NORMAL)
                return false;
            const frame = win.get_frame_rect();
            const touchesTop = frame.y <= panelRect.y + panelRect.height;
            const overlapsHorizontally =
                frame.x < panelRect.x + panelRect.width && frame.x + frame.width > panelRect.x;
            return touchesTop && overlapsHorizontally;
        });
    }

    async _check() {
        if (this._isDestroyed)
            return;

        const panelRect = this._getPanelRect();
        const touching = this._findTouchingWindow(panelRect);

        const sampleX = Math.round(panelRect.x + panelRect.width / 2);
        // Touching window: sample WINDOW_TOUCH_SAMPLE_INSET px into the window, past its own
        // CSD border/shadow/compositing gap right at the seam -- see windowTouchSampleY()'s
        // own docstring for why panelBottom + 1 reliably reads as white/light grey instead of
        // the window's real chrome color.
        // Transparent panel: sample mid-panel so pick_color sees wallpaper through it.
        const sampleY = touching
            ? windowTouchSampleY(panelRect.y, panelRect.height)
            : Math.max(0, Math.round(panelRect.y + panelRect.height / 2));

        let color;
        try {
            const screenshot = new Shell.Screenshot();
            [color] = await screenshot.pick_color(sampleX, sampleY);
        } catch (e) {
            logError(e, '[macos-top-panel] pick_color failed');
            return;
        }

        if (this._isDestroyed || !color)
            return;

        const r = color.red;
        const g = color.green;
        const b = color.blue;
        const foreground = foregroundForBackground(r, g, b);
        // Opaque, not translucent -- see windowTouchFill()'s own docstring. An earlier
        // version of this used a translucent liquid-glass-style fill (rgba a: 0.6); that
        // mixed the sampled window color with the wallpaper showing through underneath, so
        // the bar read as a wallpaper-tinted color instead of matching the window's actual
        // chrome, which was the entire point of sampling it in the first place.
        const blendColor = touching ? windowTouchFill(r, g, b) : null;

        if (blendColor === this._lastBlendColor && foreground === this._lastForeground)
            return;

        this._lastBlendColor = blendColor;
        this._lastForeground = foreground;
        this._onChange({blendColor, foreground});
    }
}
