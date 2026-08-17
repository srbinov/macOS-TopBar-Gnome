import Shell from 'gi://Shell';

// peachySearch (peachOS's Spotlight-equivalent) should never show a dock/dash icon while
// running, the same way real Spotlight has no Dock presence on macOS. The standard GTK-level
// signals for this -- skip_taskbar_hint, type_hint=UTILITY (both set in ulauncher_window.py) --
// don't actually reach Mutter here: verified directly by removing peachySearch's installed
// .desktop file entirely (which should prevent any app association at all) and the dock *still*
// showed an icon, using the window's own icon_name property. That means GNOME Shell falls back
// to a synthetic "windowless app" wrapper for the untracked window rather than skipping it, and
// the skip-taskbar/window-type hints GTK3 is supposed to relay over Wayland simply aren't
// arriving -- consistent with GTK3's Wayland clipboard backend also silently not working
// earlier in this project. So: don't rely on the window announcing its own hint: filter
// Shell.AppSystem's public, version-stable get_running() API directly, which is what both the
// stock GNOME Overview dash and dash2dock-lite (which reuses Main.overview.dash verbatim rather
// than reimplementing its own app enumeration) build their running-apps icon list from.

const PEACHY_SEARCH_TITLE = 'peachySearch';
const PEACHY_SEARCH_APP_IDS = ['io.ulauncher.Ulauncher.desktop', 'io.ulauncher.Ulauncher'];

function isPeachySearchApp(app) {
    if (PEACHY_SEARCH_APP_IDS.includes(app.get_id()))
        return true;
    const windows = app.get_windows ? app.get_windows() : [];
    return windows.some(w => w.get_title() === PEACHY_SEARCH_TITLE);
}

let _originalGetRunning = null;

export function installDashFilter() {
    const appSystem = Shell.AppSystem.get_default();
    if (_originalGetRunning)
        return; // already installed
    _originalGetRunning = appSystem.get_running.bind(appSystem);
    appSystem.get_running = () => _originalGetRunning().filter(app => !isPeachySearchApp(app));
}

export function uninstallDashFilter() {
    if (!_originalGetRunning)
        return;
    Shell.AppSystem.get_default().get_running = _originalGetRunning;
    _originalGetRunning = null;
}
