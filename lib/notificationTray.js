import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import {State, Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

// Fallback identity for a notification with no real app behind it (e.g. a bare `notify-send`
// with no -i/--icon and no -a/--app-name) -- peachOS's own System Settings app, same Icon=/
// Name= values as its real .desktop file, rather than showing GNOME's own generic bell icon
// or a blank space where an app icon should be.
const FALLBACK_ICON_PATH = '/usr/share/icons/peachos/systemsettings_icon.svg';
const FALLBACK_TITLE = 'System Settings';

// Real macOS notification banners slide in from the right edge of the screen and settle at
// the top right, fading in as they go -- no vertical movement, no bounce. Stock GNOME slides
// straight down from off-screen top with an EASE_OUT_BACK overshoot instead. Rather than fork
// the whole MessageTray class, only the two methods that actually run the tween
// (_updateShowingNotification, _hideNotification) are monkey-patched onto the live
// Main.messageTray *instance* -- same pattern as dashFilter.js's Shell.AppSystem patch --
// so every surrounding behavior GNOME already gets right (queueing, focus, idle watch, mouse
// tracking, auto-hide timeout, expand-on-click, screen readers) is untouched and still runs
// through the original, unmodified code paths.
const SLIDE_DURATION = 350;
// How far past the banner's own resting position (in px) it starts/ends, i.e. how far off the
// right edge of the screen it needs to travel. The banner's own width is always at least this
// large, so adding it on top guarantees a fully off-screen starting point regardless of monitor
// size.
const SLIDE_MARGIN = 40;

let _tray = null;
let _originalUpdateShowingNotification = null;
let _originalHideNotification = null;
let _originalBannerAlignment = null;
let _onNewBanner = null;

/**
 * Rough point behind where a brand-new banner is about to rest, for
 * notificationBannerGlass.js's own BackgroundAdaptiveController-style sample -- same idea as
 * controlCenterIndicator.js's _getBackgroundSamplePoint(), just derived from _bannerBin's
 * own current layout position/size instead of a panel button's, since that's the always-
 * available reference here. Must be read BEFORE this function moves the bin off-screen
 * below, while its transform still reflects the resting position it's about to animate back
 * to -- sampling after would just read the banner's own pixels once it's opaque, or empty
 * space off the right edge of the monitor while it's still hidden.
 */
function _computeSamplePoint(tray) {
    try {
        const [x, y] = tray._bannerBin.get_transformed_position();
        const [width, height] = tray._bannerBin.get_transformed_size();
        return {x: Math.round(x + width / 2), y: Math.round(y + height / 2)};
    } catch (e) {
        logError(e, '[macos-top-panel] notification tray: failed to compute sample point');
        return null;
    }
}

function patchedUpdateShowingNotification() {
    this._notification.acknowledged = true;
    this._notification.playSound();

    if (this._notification.urgency === Urgency.CRITICAL ||
        this._notification.source.policy.forceExpanded)
        this._expandBanner(true);

    // _showNotification() (untouched) sets an off-screen *vertical* starting position before
    // calling this; a HIDDEN state here means this is that brand-new banner, so give it its
    // off-screen *horizontal* starting position instead and cancel the vertical one out. An
    // already-SHOWING/SHOWN notification being updated in place should stay exactly where it
    // is -- this is the same distinction GNOME's own stock implementation relies on to decide
    // whether to animate or not.
    const isNewBanner = this._notificationState !== State.SHOWING && this._notificationState !== State.SHOWN;
    if (isNewBanner) {
        if (_onNewBanner) {
            const point = _computeSamplePoint(this);
            if (point)
                _onNewBanner(point);
        }
        // GNOME's own Message/NotificationMessage (js/ui/messageList.js) always renders a
        // MessageHeader row -- its OWN app icon, app name, timestamp, and expand/close
        // buttons -- stacked above the icon+title+body row, unconditionally, even in
        // compact banner mode (confirmed against the real source: "MessageHeader always
        // displays completely," no expansion-state visibility logic in the class at all).
        // The Settings app's own Liquid Glass preview (LiquidGlassPreview,
        // appearance_page.py) -- the reference this project's real notifications are
        // supposed to match -- has never shown any of that: just one icon, a bold title,
        // and a body line, the same compact shape a real macOS banner uses. That header
        // row is a St actor property (visible), not something CSS can reliably remove (St's
        // simplified engine has no confirmed `display:none` equivalent -- see
        // notificationBannerGlass.js's own selector debugging history for why CSS-only
        // guesses aren't trusted here anymore), so it's hidden directly here instead, the
        // same monkey-patched entry point already used for the slide-in animation. Hides
        // the header's own duplicate icon, app-name/timestamp row, AND the close button --
        // matching the preview exactly means no persistent close button either, same as a
        // real macOS banner (dismissed by the auto-timeout, Notification Center, or
        // clicking elsewhere, not an always-visible X).
        if (this._banner._header)
            this._banner._header.visible = false;

        // A notification with no real app behind it (bare `notify-send`, no -i/--icon) has
        // notification.gicon left null -- falls back to peachOS Settings' own icon/name
        // rather than showing nothing (this._notification.gicon is a real GObject property
        // via GObject.ParamSpec.object in messageTray.js's own Notification class, and the
        // rendered message-icon reactively follows it, same as it follows every other
        // notification's real gicon -- setting it here is the same mechanism a real app's
        // own icon reaches the screen through, not a separate rendering path). title is left
        // alone if the notification already set one (a bare notify-send's first argument
        // becomes the title/summary already, so this only fills in a genuinely empty one).
        if (!this._notification.gicon)
            this._notification.gicon = Gio.icon_new_for_string(FALLBACK_ICON_PATH);
        if (!this._notification.title)
            this._notification.title = FALLBACK_TITLE;

        // stylesheet.css's own `.notification-banner { max-width: 28.8em !important; }` is a
        // genuinely parsed St property (confirmed against St's real source,
        // st_theme_node_get_max_width() in st-theme-node.c, before trusting it) -- but
        // confirmed LIVE, against a real screenshot, that it doesn't actually constrain this
        // particular actor's real allocated width: a short "test" notification still
        // rendered at the full ~460px, mostly empty space. Almost certainly the x_expand:true
        // chain through Message's own vbox/contentBox (js/ui/messageList.js's constructor)
        // claiming all available width the parent hands it, regardless of what max-width on
        // this actor would otherwise want to cap it to -- CSS max-width constrains this
        // actor's own box, not whether its expanding children get offered that much room to
        // begin with. Enforced directly in JS instead, the same "set the actor property
        // myself" pattern already proven reliable tonight for the header and icon fallback,
        // rather than trust a fourth CSS-only guess. Reads the *same* max-width the
        // stylesheet already declares (via the theme node St itself resolved it into, so the
        // 28.8em -> px conversion -- including this system's own text-scaling-factor --
        // always matches the CSS, never a separately hardcoded number that could drift out of
        // sync with it) and clamps to whichever is smaller: the banner's own natural,
        // content-driven width, or that cap. Verified get_max_width/get_preferred_width/
        // get_theme_node are real methods via GI typelib introspection (not a live Shell
        // call) before using them here.
        const themeNode = this._banner.get_theme_node();
        const maxWidth = themeNode.get_max_width();
        if (maxWidth > 0) {
            const [, naturalWidth] = this._banner.get_preferred_width(-1);
            this._banner.width = Math.min(naturalWidth, maxWidth);
        }

        this._bannerBin.y = 0;
        this._bannerBin.translation_x = this._banner.width + SLIDE_MARGIN;
    }

    this._notificationState = State.SHOWING;
    this._bannerBin.remove_all_transitions();
    this._bannerBin.ease({
        opacity: 255,
        duration: SLIDE_DURATION,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    this._bannerBin.ease({
        translation_x: 0,
        duration: SLIDE_DURATION,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            this._notificationState = State.SHOWN;
            this._showNotificationCompleted();
            this._updateState();
        },
    });
}

function patchedHideNotification(animate) {
    this._notificationFocusGrabber.ungrabFocus();
    this._banner.disconnectObject(this);

    this._resetNotificationLeftTimeout();
    this._bannerBin.remove_all_transitions();

    const duration = animate ? SLIDE_DURATION : 0;
    this._notificationState = State.HIDING;
    this._bannerBin.ease({
        opacity: 0,
        duration,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
    });
    this._bannerBin.ease({
        translation_x: this._banner.width + SLIDE_MARGIN,
        duration,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onStopped: () => {
            this._notificationState = State.HIDDEN;
            this._hideNotificationCompleted();
            this._updateState();
        },
    });
}

/**
 * @param {*} messageTray
 * @param {(point: {x: number, y: number}) => void} [onNewBanner] called once per brand-new
 *   banner, right before it's moved off-screen to start its slide-in -- see
 *   notificationBannerGlass.js's sampleAdaptive(), which this project wires it to.
 */
export function installNotificationSlide(messageTray, onNewBanner) {
    if (_tray)
        return; // already installed

    _tray = messageTray;
    _onNewBanner = onNewBanner ?? null;
    _originalBannerAlignment = _tray.bannerAlignment;
    _tray.bannerAlignment = Clutter.ActorAlign.END;

    _originalUpdateShowingNotification = _tray._updateShowingNotification;
    _originalHideNotification = _tray._hideNotification;
    _tray._updateShowingNotification = patchedUpdateShowingNotification;
    _tray._hideNotification = patchedHideNotification;
}

export function uninstallNotificationSlide() {
    if (!_tray)
        return;

    _tray.bannerAlignment = _originalBannerAlignment;
    _tray._updateShowingNotification = _originalUpdateShowingNotification;
    _tray._hideNotification = _originalHideNotification;
    _tray._bannerBin.remove_all_transitions();
    _tray._bannerBin.translation_x = 0;

    _tray = null;
    _onNewBanner = null;
    _originalUpdateShowingNotification = null;
    _originalHideNotification = null;
    _originalBannerAlignment = null;
}
