import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';

import {glassStyleString, SHARED_RECIPE, ADAPTIVE_RECIPE} from './liquidGlassIntensity.js';
import {relativeLuminance} from './colorUtil.js';
import {LIGHT_LUMINANCE_THRESHOLD} from './backgroundAdaptiveController.js';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

// Same fallback identity as notificationTray.js's live banner -- see that file's own comment
// for the full reasoning. Kept as a separate constant here (not imported/shared) since these
// two files don't otherwise share any module state.
const FALLBACK_ICON_PATH = '/usr/share/icons/peachos/systemsettings_icon.svg';
const FALLBACK_TITLE = 'System Settings';

const PANEL_SCHEMA_ID = 'org.gnome.shell.extensions.macos-top-panel';
const INTERFACE_SCHEMA_ID = 'org.gnome.desktop.interface';

// macOS-style Notification Center: a liquid-glass panel that slides in from the right edge
// of the screen, docked just below the top bar. Deliberately does *not* reimplement
// notification storage, per-app stacking, or the stack -> list expand animation --
// Calendar.CalendarMessageList (GNOME's own notification-history widget, normally only ever
// seen tucked inside the stock date menu's popup, which this extension's ClockWidget doesn't
// use) already does exactly that: it self-sources live from Main.messageTray, groups
// per-app notifications into a NotificationMessageGroup "stack" that fans out into a list on
// click (see messageList.js's NotificationMessageGroup.expand()/collapse(), driven by a
// Clutter.ClickGesture on the stack's cover), and provides a working "Clear" button and
// empty-state placeholder for free. This file only supplies the sliding, glass-styled chrome
// around one fresh instance of that same widget.
const SLIDE_DURATION = 350;
const GLASS_PADDING = 16; // liquid-glass border/inset padding around CalendarMessageList's own ~29em width
const EDGE_MARGIN = 12; // gap kept from the screen's right/top/bottom edges, floating-card style

const DOCK_ACTOR_NAME = 'dashtodockContainer'; // dash2dock-lite's own name for its dock actor,
                                                // same constant lib/appLauncher.js and
                                                // lib/dockOrderGuard.js already use

function _findActorByName(actor, name) {
    if (actor.name === name)
        return actor;
    for (const child of actor.get_children()) {
        const found = _findActorByName(child, name);
        if (found)
            return found;
    }
    return null;
}

export class NotificationCenterPanel {
    constructor() {
        this._open = false;
        this._capturedEventId = 0;

        this._messageList = new Calendar.CalendarMessageList();
        // CalendarMessageList sets its own x_expand: true (see calendar.js), but its actual
        // rendered width is capped by the theme's .message-list { width: 29em } rule -- inside
        // a BoxLayout parent that's wider than that (any rounding slop between the panel's
        // computed width in _reposition() and this actor's real CSS width), an expanding but
        // width-capped child was landing flush against the start edge instead of centered in
        // the leftover space. Forcing CENTER here makes it correct regardless of exactly how
        // that arithmetic lines up.
        this._messageList.x_align = Clutter.ActorAlign.CENTER;
        // St.BoxLayout sizes a vertical child to its own natural/content height by default,
        // not to the box's available space -- without an explicit FILL here, this list just
        // grew to fit every expanded notification and overflowed past the panel's own fixed
        // height (set in _reposition()) instead of ever handing its internal St.ScrollView a
        // bounded viewport to actually scroll within. FILL is what makes the scroll view's
        // allocation stop at the panel's edge, which is what makes it scroll at all.
        this._messageList.y_align = Clutter.ActorAlign.FILL;

        // CalendarMessageList's own scroll view (calendar.js) ships with overlay_scrollbars:
        // true, but that's still a visible (if thin) bar. Reaching into its private
        // _scrollView to fully hide it -- vscrollbar-policy: NEVER removes the bar's own
        // allocation entirely rather than just making it invisible, while wheel/trackpad
        // scrolling keeps working via St.ScrollView's separate enable-mouse-scrolling
        // (unaffected by the policy, on by default).
        this._messageList._scrollView.vscrollbar_policy = St.PolicyType.NEVER;

        // Real macOS lets you expand as many notification stacks as you want at once. Stock
        // GNOME only ever allows ONE group expanded -- MessageView._setExpandedGroup forcibly
        // collapses whichever group was previously expanded the instant a different one gets
        // opened (see messageList.js), which is also *why* switching stacks looked janky:
        // two competing collapse/expand animations firing back to back instead of one clean
        // one. _addNotificationSource is where that exclusive wiring gets set up per
        // notification source, so it's patched here (same instance-patch approach as
        // dashFilter.js/notificationTray.js elsewhere in this extension) to toggle each
        // group's own expand()/collapse() directly, independent of every other group, instead
        // of routing through _setExpandedGroup's single-slot bookkeeping. This only affects
        // sources added from here on -- but that's every real notification, since this runs
        // immediately on construction, well before any of them exist.
        const messageView = this._messageList._messageView;
        messageView._addNotificationSource = function (source) {
            // Real macOS doesn't dismiss a notification from Notification Center just
            // because you clicked it -- only an explicit dismiss (the X button, "Clear")
            // removes one. Stock GNOME's NotificationMessage.vfunc_clicked calls
            // notification.activate(), which -- per messageTray.js's Notification.activate()
            // -- destroys the notification unless it's flagged "resident". That's the "click
            // it and it vanishes" bug. The natural fix would be overriding vfunc_clicked
            // itself, but that doesn't work: vfunc_ methods are GObject virtual functions,
            // wired into the C-level vtable once at the class's original GObject.registerClass
            // call (baked into gnome-shell's own compiled binary, long before this extension
            // loads) -- reassigning NotificationMessage.prototype.vfunc_clicked afterward is
            // silently ignored, unlike a normal method such as this one. resident is a real
            // GObject property though, and activate() already has this exact escape hatch
            // built in, so setting it here sidesteps the vtable problem entirely: activation
            // (opening/focusing the app) still happens via the 'activated' signal, it just no
            // longer destroys the notification as a side effect.
            const makeResident = notification => {
                notification.resident = true;
            };
            source.notifications.forEach(makeResident);
            source.connect('notification-added', (_s, notification) => makeResident(notification));

            const group = new MessageList.NotificationMessageGroup(source);

            // Same header-hiding fix as the live banner (notificationTray.js) -- the
            // individual NotificationMessage widgets this group creates per-notification
            // (real gnome-shell source: _addNotification(notification), extends the same
            // Message class the banner uses) get the exact same always-visible MessageHeader
            // row (duplicate app icon, app name, timestamp, expand/close buttons) the Settings
            // preview never modeled, and the user explicitly asked for the same look here too.
            // NotificationMessageGroup itself is NOT a Message subclass (it has its own
            // separate, already-conditionally-hidden .message-group-header instead, untouched
            // here), only the individual messages inside it need this. _addNotification is a
            // plain method (not a vfunc_-prefixed GObject virtual, which this same file's own
            // comment above already established can't be reassigned post-registration), so
            // it's safe to wrap the same way _addNotificationSource itself is already patched.
            const originalAddNotification = group._addNotification.bind(group);
            group._addNotification = function (notification) {
                // Same fallback icon/title as the live banner (notificationTray.js) -- applied
                // to the underlying notification data model before the widget is built, so
                // whatever this same notification looked like in the banner is exactly what
                // shows up here too (a real notify-send test notification's gicon/title are
                // set once and reused everywhere it's displayed, not re-decided per surface).
                if (!notification.gicon)
                    notification.gicon = Gio.icon_new_for_string(FALLBACK_ICON_PATH);
                if (!notification.title)
                    notification.title = FALLBACK_TITLE;

                originalAddNotification(notification);
                const message = this._notificationToMessage.get(notification);
                if (message && message._header)
                    message._header.visible = false;
            };
            // Anything already in the group from before this patch was applied (shouldn't
            // normally happen -- this runs synchronously right after construction, before
            // any notification could have been added yet -- but cheap to cover regardless).
            group._notificationToMessage.forEach(message => {
                if (message._header)
                    message._header.visible = false;
            });

            this._notificationSourceToGroup.set(source, group);

            // The group's own Clutter.ClickGesture (passed as `actions:` in
            // NotificationMessageGroup's constructor) is attached to the whole group actor,
            // not scoped to just its "cover" -- while collapsed that's fine, since the cover
            // is the only reactive thing on top. But expand() only *hides* the cover
            // (messageList.js), it doesn't stop the group's own gesture from still
            // recognizing clicks anywhere in its bounds, including on the now-visible
            // individual notifications underneath. So clicking a notification while its
            // stack was expanded *also* fired this same group's 'expand-toggle-requested',
            // which (since the group was already expanded) collapsed the whole stack back
            // down right as you tried to interact with it. Keeping the gesture's own enabled
            // state in sync with expanded state (via notify::expanded, so this covers every
            // path that can change it, not just this handler -- e.g. Escape collapsing
            // everything) means it's only listening at all while collapsed, exactly the state
            // it needs to be clickable in.
            const [groupGesture] = group.get_actions();
            group.connect('notify::expanded', () => {
                groupGesture.enabled = !group.expanded;
            });

            group.connectObject(
                'notify::focus-child', () => this._onKeyFocusIn(group.focusChild),
                'expand-toggle-requested', () => {
                    if (group.expanded)
                        group.collapse();
                    else
                        group.expand();
                },
                'notify::has-urgent', () => {
                    if (group.hasUrgent)
                        this._nUrgent++;
                    else
                        this._nUrgent--;

                    const index = this._playerToMessage.size + (group.hasUrgent ? 0 : this._nUrgent);
                    this._moveMessage(group, index);
                },
                'notification-added', () => {
                    const index = this._playerToMessage.size + (group.hasUrgent ? 0 : this._nUrgent);
                    this._moveMessage(group, index);
                }, this);

            if (group.hasUrgent)
                this._nUrgent++;

            const index = this._playerToMessage.size + (group.hasUrgent ? 0 : this._nUrgent);
            this._addMessageAtIndex(group, index);
        };

        this._panel = new St.BoxLayout({
            style_class: 'macos-notification-center',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            visible: false,
            clip_to_allocation: true,
        });
        this._panel.add_child(this._messageList);

        // Liquid Glass intensity slider (Settings -> Appearance -> Liquid Glass). Plain
        // inline `.style` on this._panel -- .macos-notification-center carries no
        // !important, so it wins cleanly (see controlCenterIndicator.js's own
        // _applyGlassIntensity() for the fuller explanation, and
        // notificationBannerGlass.js for the different mechanism .notification-banner
        // needs instead, since that one DOES fight the theme with !important).
        this._panelSettings = new Gio.Settings({schema_id: PANEL_SCHEMA_ID});
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA_ID});
        this._glassSettingsChangedId = this._panelSettings.connect(
            'changed::liquid-glass-intensity', () => this._applyGlassIntensity());
        this._glassColorSchemeChangedId = this._interfaceSettings.connect(
            'changed::color-scheme', () => this._applyGlassIntensity());
        // Same adaptive-dark-over-bright-content behavior as the Control Center's tiles
        // (backgroundAdaptiveController.js) and the notification banners
        // (notificationBannerGlass.js's sampleAdaptive()) -- sampled fresh each open() (see
        // there), reset back to default the instant close() starts (see there too). This
        // panel already uses plain inline `.style` rather than either of those two's
        // dynamic-stylesheet workaround (no !important fight to have here -- see the class
        // doc above), so no extra machinery is needed beyond picking which recipe/isDarkMode
        // _applyGlassIntensity() interpolates from.
        this._forceAdaptiveDark = false;
        this._applyGlassIntensity();

        // Covers the whole screen behind the panel; only reactive while open, so any click
        // outside the panel (the panel itself sits on top and intercepts its own clicks
        // first) closes it -- the standard scrim-behind-a-flyout pattern.
        this._scrim = new St.Widget({reactive: false, visible: false});
        this._scrim.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });

        // Both static, fixed-geometry actors (only ever moved/resized once, in _reposition());
        // the open/close animation itself is a pure translation_x transform on top, same
        // approach as the notification banner slide in notificationTray.js. Scrim added
        // first so the panel (added second) paints above it.
        //
        // Deliberately no params (in particular, no {trackFullscreen: true}): that option
        // doesn't just retarget positioning on fullscreen changes, it makes the layout
        // manager *own* the actor's visible property outright -- "hidden whenever a
        // fullscreen window is visible, shown otherwise" (see layout.js's addChrome doc
        // comment). With no fullscreen window present, which is the normal case right after
        // login, that binding force-shows the panel immediately on enable(), overriding the
        // visible: false above -- with _reposition() never having run yet, it rendered at
        // its default (0, 0) origin, i.e. the top-left corner, with no click involved at
        // all. open()/close() already manage visibility explicitly; nothing here should.
        Main.layoutManager.addChrome(this._scrim);
        Main.layoutManager.addChrome(this._panel);

        // Belt-and-suspenders alongside removing trackFullscreen above: gives the panel its
        // real, correct resting geometry right away instead of leaving it at its (0, 0)
        // default. It's still invisible either way, but if anything else were ever to flip
        // it visible unexpectedly, it should end up docked correctly at the right edge
        // rather than a stray box in the top-left corner.
        this._reposition();
    }

    get isOpen() {
        return this._open;
    }

    toggle() {
        if (this._open)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._open)
            return;
        this._open = true;

        this._reposition();
        // After _reposition() (so this._panel's geometry is the real resting one) but
        // before it's made visible below -- otherwise this would just sample the panel's
        // own just-drawn pixels instead of whatever's actually behind it.
        this._sampleAdaptive();

        this._scrim.set_position(0, 0);
        this._scrim.set_size(global.stage.width, global.stage.height);
        this._scrim.reactive = true;
        this._scrim.visible = true;

        this._panel.visible = true;
        this._panel.opacity = 0;
        this._panel.translation_x = this._panel.width + EDGE_MARGIN * 2;
        this._panel.remove_all_transitions();
        this._panel.ease({
            translation_x: 0,
            opacity: 255,
            duration: SLIDE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._capturedEventId = global.stage.connect('captured-event', this._onCapturedEvent.bind(this));
    }

    close() {
        if (!this._open)
            return;
        this._open = false;

        // Back to default now, not just when the next open()'s fresh sample resolves --
        // same "reset the instant closing starts" convention BackgroundAdaptiveController's
        // own reset() uses, so a stale adaptive-dark look never lingers into whatever opens
        // next before its own sample comes back.
        if (this._forceAdaptiveDark) {
            this._forceAdaptiveDark = false;
            this._applyGlassIntensity();
        }

        this._scrim.reactive = false;

        this._panel.remove_all_transitions();
        this._panel.ease({
            translation_x: this._panel.width + EDGE_MARGIN * 2,
            opacity: 0,
            duration: SLIDE_DURATION,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                this._panel.visible = false;
                this._scrim.visible = false;
            },
        });

        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    }

    // Only handles Escape now -- collapses whatever's currently expanded (there can be
    // several, since stacks are independent now), or closes the whole panel if nothing is.
    // There used to also be a "click outside an expanded group collapses it" branch here
    // (mirroring CalendarMessageList's own maybeCollapseMessageGroupForEvent), but under
    // independent multi-expand that was actively wrong: clicking a *second* stack's cover to
    // expand it is, from the first stack's point of view, a click "outside" it -- so that
    // logic was collapsing the first stack the instant you tried to open a second one, which
    // is the exact bug this whole patch exists to fix. Each group already handles its own
    // click-to-toggle (see the expand-toggle-requested handler above); a click truly outside
    // the panel entirely still closes it via the scrim's own button-press-event.
    _onCapturedEvent(_actor, event) {
        if (event.type() === Clutter.EventType.KEY_PRESS &&
            event.get_key_symbol() === Clutter.KEY_Escape) {
            const expanded = this._messageList._messageView.messages.filter(m => m.expanded && m.collapse);
            if (expanded.length > 0) {
                expanded.forEach(group => group.collapse());
                return Clutter.EVENT_STOP;
            }
            this.close();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    // dash2dock-lite's dock actor isn't something this file owns or imports directly (avoids
    // coupling to its internal module structure). Unlike appLauncher.js's identical-looking
    // lookup, this one deliberately does NOT cache a miss permanently: appLauncher.js only
    // ever searches on-demand, well after login when the dock is guaranteed to already exist,
    // but this file's first call happens in the constructor -- i.e. at extension-enable time,
    // which races dash2dock-lite's own enable() with no guaranteed order. Caching "not found"
    // from that first race would wedge this panel at full (dock-overlapping) height for the
    // rest of the session even once the dock actor shows up moments later. A successful find
    // is still cached (the actor doesn't move once created), so this only re-walks the tree
    // on the rare miss, not on every reposition.
    _getDockActor() {
        if (!this._dockActor)
            this._dockActor = _findActorByName(Main.layoutManager.uiGroup, DOCK_ACTOR_NAME);
        return this._dockActor;
    }

    // How much room (if any) the dock is actually occupying at the bottom of this monitor
    // right now. Reads the dock's own live transformed bounds rather than any of
    // dash2dock-lite's internal autohide/dodge state -- that state machine (see dock.js's
    // animate()/animator.js) is well past what's worth coupling to just to avoid overlapping
    // it, and the transformed bounds already reflect wherever it actually, visually is:
    // slid off-screen during autohide, shrunk during window-dodge, or sitting at full size,
    // all fall out of this same check for free. Only counts when the dock's bottom edge is
    // actually near the monitor's bottom edge (bottom-docked, the macOS-style default this
    // whole project ships) -- a left/right-docked or off-screen dock shouldn't shrink this
    // panel at all.
    _dockReservedHeight(monitor) {
        const dock = this._getDockActor();
        if (!dock || !dock.visible || dock.opacity === 0)
            return 0;

        const [, dockY] = dock.get_transformed_position();
        const [, dockHeight] = dock.get_transformed_size();
        if (dockHeight <= 0)
            return 0;

        const monitorBottom = monitor.y + monitor.height;
        const dockBottom = dockY + dockHeight;
        // Within a few pixels of the monitor's own bottom edge -- not just "somewhere in the
        // lower half", so a left/right-docked dock (full monitor height, bottom edge always
        // "near" the bottom) doesn't get misread as bottom-docked.
        if (Math.abs(dockBottom - monitorBottom) > EDGE_MARGIN * 2)
            return 0;

        return Math.max(0, monitorBottom - dockY);
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const panelBoxHeight = Main.layoutManager.panelBox.height || 0;
        const width = Math.round(this._messageList.width || 380) + GLASS_PADDING * 2;
        const top = monitor.y + panelBoxHeight + EDGE_MARGIN;
        const dockReserved = this._dockReservedHeight(monitor);
        const bottomReserved = dockReserved > 0 ? dockReserved + EDGE_MARGIN : EDGE_MARGIN;
        const height = monitor.height - panelBoxHeight - EDGE_MARGIN - bottomReserved;
        const left = monitor.x + monitor.width - width - EDGE_MARGIN;

        this._panel.set_position(Math.round(left), Math.round(top));
        this._panel.set_size(width, Math.round(height));

        // Explicit pixel height directly on the actual St.ScrollView, rather than trusting
        // FILL/expand to cascade correctly through CalendarMessageList's own BinLayout ->
        // its internal "box" BoxLayout -> this ScrollView (three layers of layout managers
        // this file doesn't control) -- that cascade wasn't reliably handing the scroll view
        // a *bounded* viewport, so it just grew to fit all (possibly multi-expanded) content
        // instead of ever needing to scroll. A hard height here removes any doubt: content
        // taller than this scrolls, full stop. Subtracting the controls row's (the "Clear"
        // button strip) own natural height, read live off its actual actor rather than
        // hardcoded, so it stays correct if the theme/text-scaling ever changes that row's size.
        const contentHeight = Math.round(height) - GLASS_PADDING * 2;
        const controlsHeight = this._messageList._clearButton.get_parent().get_preferred_height(-1)[1];
        this._messageList._scrollView.set_height(Math.max(0, contentHeight - controlsHeight));
    }

    _applyGlassIntensity() {
        if (!this._panelSettings || !this._panel)
            return; // destroy() may have already torn this down (e.g. an in-flight sample)
        const intensity = this._panelSettings.get_int('liquid-glass-intensity');
        // Forced true once _sampleAdaptive() finds something bright behind the panel --
        // same reasoning as the other two surfaces' own ADAPTIVE_RECIPE use: the sampled
        // content is what's driving "this needs to be dark", not the system light/dark
        // setting, so it always targets the same SOLID_DARK endpoint regardless of the
        // system isDarkMode below.
        const isDarkMode = this._forceAdaptiveDark ||
            this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        const recipe = this._forceAdaptiveDark ? ADAPTIVE_RECIPE : SHARED_RECIPE;
        this._panel.style = glassStyleString(recipe, intensity, isDarkMode);
    }

    /**
     * Samples the screen point behind the panel's own (already repositioned, not-yet-
     * visible) resting rect -- center of the rect is good enough, same "doesn't need to be
     * exact" tolerance controlCenterIndicator.js's own sample point comment describes.
     */
    async _sampleAdaptive() {
        // TEMPORARILY DISABLED alongside notificationBannerGlass.js's own sampleAdaptive() --
        // see that file's comment for the full reasoning (a real crash-loop, correlated via
        // journalctl with live notification tests across multiple unrelated CSS edits, most
        // likely caused by this same Shell.Screenshot().pick_color() call). This call site is
        // a different trigger (opening the Notification Center popup, not a live notification
        // banner) but the same risky API, disabled out of the same caution rather than because
        // it was independently confirmed to crash on its own.
        return;

        // eslint-disable-next-line no-unreachable
        const [x, y] = this._panel.get_position();
        const [width, height] = this._panel.get_size();
        const point = {x: Math.round(x + width / 2), y: Math.round(y + height / 2)};

        let color;
        try {
            const screenshot = new Shell.Screenshot();
            [color] = await screenshot.pick_color(point.x, point.y);
        } catch (e) {
            logError(e, '[macos-top-panel] notification center: background sample failed');
            return;
        }
        if (!color || !this._panel)
            return; // destroy() may have already torn this down while the sample was in flight

        this._forceAdaptiveDark = relativeLuminance(color.red, color.green, color.blue) >= LIGHT_LUMINANCE_THRESHOLD;
        this._applyGlassIntensity();
    }

    destroy() {
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
        if (this._glassSettingsChangedId) {
            this._panelSettings.disconnect(this._glassSettingsChangedId);
            this._glassSettingsChangedId = 0;
        }
        if (this._glassColorSchemeChangedId) {
            this._interfaceSettings.disconnect(this._glassColorSchemeChangedId);
            this._glassColorSchemeChangedId = 0;
        }
        Main.layoutManager.removeChrome(this._panel);
        Main.layoutManager.removeChrome(this._scrim);
        this._panel.destroy();
        this._scrim.destroy();
        this._panel = null;
        this._scrim = null;
        this._messageList = null;
    }
}
