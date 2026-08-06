/*
 * Watches for windows touching the top of the screen and reports a
 * sampled background color while one is; reports null when nothing is.
 *
 * `pick_color()` samples the actual composited screen pixel, so it's
 * correct regardless of which window is topmost at that point -- the
 * window search below only decides *whether* to sample at all.
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

// A second pass a bit after the first, to catch cases where a window's
// visual position/paint hasn't settled yet when the first check runs
// (e.g. the unminimize/maximize animation is still mid-flight) -- Meta
// updates a window's logical frame_rect immediately, but pick_color()
// samples the actually-composited pixel, which can still be mid-animation.
const SETTLE_RECHECK_MS = 500;

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
        this._settleTimeoutId = 0;
        this._isDestroyed = false;
    }

    enable() {
        const wm = global.window_manager;
        // 'size-change' covers maximize/unmaximize/fullscreen/tile.
        // 'minimize'/'unminimize'/'map' are separate signals in Shell.WM --
        // size-change alone misses a window being minimized away or
        // reopened, which is exactly the "reopen and it doesn't reapply"
        // case.
        this._signalIds.push([wm, wm.connect('size-change', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('minimize', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('unminimize', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('map', () => this._scheduleCheck())]);
        this._signalIds.push([wm, wm.connect('switch-workspace', () => this._scheduleCheck())]);
        this._signalIds.push([global.display,
            global.display.connect('notify::focus-window', () => this._scheduleCheck())]);
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
        if (this._settleTimeoutId) {
            GLib.source_remove(this._settleTimeoutId);
            this._settleTimeoutId = 0;
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

            if (this._settleTimeoutId)
                GLib.source_remove(this._settleTimeoutId);
            this._settleTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_RECHECK_MS, () => {
                this._settleTimeoutId = 0;
                this._check().catch(e => logError(e, '[macos-top-panel] window color blend re-check failed'));
                return GLib.SOURCE_REMOVE;
            });

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

        if (!touching) {
            this._onColorChange(null);
            return;
        }

        const sampleX = Math.round(panelRect.x + panelRect.width / 2);
        const sampleY = panelRect.y + panelRect.height + 1;

        const screenshot = new Shell.Screenshot();
        const [color] = await screenshot.pick_color(sampleX, sampleY);
        if (this._isDestroyed || !color)
            return;

        this._onColorChange(`rgb(${color.red}, ${color.green}, ${color.blue})`);
    }
}
