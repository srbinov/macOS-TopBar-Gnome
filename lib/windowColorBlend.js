/*
 * Watches for a maximized/fullscreen window on the panel's monitor and
 * reports a sampled background color while one exists; reports null
 * otherwise (nothing maximized/fullscreen -> panel stays transparent).
 *
 * Deliberately keyed off Mutter's own maximized/fullscreen state rather
 * than comparing window geometry to the panel's position -- geometry
 * comparisons are fragile (CSD frame-rect quirks, a window merely being
 * dragged near the top without being snapped, multi-monitor setups) and
 * don't match the actual intent, which is "does *some* window currently
 * own the full top of the screen the way a maximized macOS app does".
 * `maximized-horizontally`/`maximized-vertically`/`fullscreen` are exact
 * booleans Mutter maintains itself, with signals that fire precisely when
 * they change -- no polling or extra heuristics needed.
 *
 * `pick_color()` samples the actual composited screen pixel, so the
 * reported color is correct regardless of which window is topmost.
 *
 * Cogl.Color's red/green/blue fields are UINT8 (0-255), confirmed via
 * GIRepository introspection against this machine's real Shell/Cogl
 * typelibs, not assumed.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

const DEBOUNCE_MS = 300;

/**
 * @param {() => {x: number, y: number, width: number, height: number}} getPanelRect
 * @param {(cssColor: string|null) => void} onColorChange
 */
export class WindowColorBlend {
    constructor(getPanelRect, onColorChange) {
        this._getPanelRect = getPanelRect;
        this._onColorChange = onColorChange;
        this._signalIds = [];
        this._timeoutId = 0;
        this._isDestroyed = false;
    }

    enable() {
        const wm = global.window_manager;
        // 'size-change' fires precisely on maximize/unmaximize/fullscreen
        // transitions -- exactly the state this class cares about.
        this._signalIds.push([wm, wm.connect('size-change', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('minimize', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('unminimize', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('map', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('destroy', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('switch-workspace', () => this._scheduleCheck())]);
        this._signalIds.push([global.display,
            global.display.connect('window-created', () => this._scheduleCheck())]);
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

    _findCoveringWindow() {
        const panelMonitor = global.display.get_primary_monitor();
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().find(win => {
            if (win.minimized || win.get_window_type() !== Meta.WindowType.NORMAL)
                return false;
            if (win.get_monitor() !== panelMonitor)
                return false;
            const isMaximized = win.maximized_horizontally && win.maximized_vertically;
            return isMaximized || win.is_fullscreen();
        });
    }

    async _check() {
        if (this._isDestroyed)
            return;

        const covering = this._findCoveringWindow();
        if (!covering) {
            this._onColorChange(null);
            return;
        }

        const panelRect = this._getPanelRect();
        const sampleX = Math.round(panelRect.x + panelRect.width / 2);
        const sampleY = panelRect.y + panelRect.height + 1;

        const screenshot = new Shell.Screenshot();
        const [color] = await screenshot.pick_color(sampleX, sampleY);
        if (this._isDestroyed || !color)
            return;

        this._onColorChange(`rgb(${color.red}, ${color.green}, ${color.blue})`);
    }
}
