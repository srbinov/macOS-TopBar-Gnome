import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';

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

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const panelBoxHeight = Main.layoutManager.panelBox.height || 0;
        const width = Math.round(this._messageList.width || 380) + GLASS_PADDING * 2;
        const top = monitor.y + panelBoxHeight + EDGE_MARGIN;
        const height = monitor.height - panelBoxHeight - EDGE_MARGIN * 2;
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

    destroy() {
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
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
