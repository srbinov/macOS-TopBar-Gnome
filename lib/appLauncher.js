import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// macOS-style Launchpad: a full-screen, dimmed overlay showing every installed app in a
// paged grid, triggered from a Dock icon rather than launched as a real windowed app (see
// the peachos-applauncher.desktop entry this exposes a toggle for over D-Bus). Deliberately
// a flat dark tint, not a real Shell.BlurEffect backdrop -- this project's own liquid-glass
// doc (docs/liquid-glass-style.md) already establishes why: Shell.BlurEffect on popup-style
// chrome caused real Clutter paint-abort crashes here before, and this overlay (full-screen,
// covering everything) has an even bigger blast radius if that same class of bug showed up
// again, so it isn't worth the risk for a visual nicety.
const BUS_NAME = 'org.peachos.AppLauncher';
const OBJECT_PATH = '/org/peachos/AppLauncher';
const IFACE_XML = `
<node>
  <interface name="${BUS_NAME}">
    <method name="Toggle" />
  </interface>
</node>`;

const FADE_DURATION = 220;
const PAGE_SLIDE_DURATION = 300;
const COLUMNS = 7;
const ROWS = 5;
const CELL_WIDTH = 132;
const CELL_HEIGHT = 132;
const ICON_SIZE = 72;
// Smooth-scroll (touchpad) delta accumulates until it crosses this before paging, so a
// single light two-finger nudge doesn't fling through several pages at once.
const SWIPE_THRESHOLD = 12;

export class AppLauncherOverlay {
    constructor() {
        this._open = false;
        this._page = 0;
        this._pages = [];
        this._allApps = [];
        this._scrollAccum = 0;
        this._capturedEventId = 0;
        this._ownerId = 0;
        this._exportedObject = null;

        this._root = new St.Widget({
            style_class: 'macos-applauncher-root',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            visible: false,
        });

        this._dim = new St.Widget({style_class: 'macos-applauncher-dim', reactive: true});
        this._dim.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this._root.add_child(this._dim);

        this._content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'macos-applauncher-content',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._root.add_child(this._content);

        this._searchEntry = new St.Entry({
            style_class: 'macos-applauncher-search',
            hint_text: 'Search',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._searchEntry.clutter_text.connect('text-changed', () => this._onSearchChanged());
        this._content.add_child(this._searchEntry);

        this._viewport = new St.Widget({
            style_class: 'macos-applauncher-viewport',
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });
        this._viewport.set_size(COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT);
        this._viewport.connect('scroll-event', this._onScroll.bind(this));
        this._content.add_child(this._viewport);

        this._pagesBox = new St.BoxLayout({orientation: Clutter.Orientation.HORIZONTAL});
        this._viewport.add_child(this._pagesBox);

        this._dotsBox = new St.BoxLayout({
            style_class: 'macos-applauncher-dots',
            spacing: 8,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._content.add_child(this._dotsBox);

        Main.layoutManager.addChrome(this._root);

        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION, BUS_NAME, Gio.BusNameOwnerFlags.NONE,
            this._onBusAcquired.bind(this), null, null,
        );
    }

    _onBusAcquired(connection) {
        this._exportedObject = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this);
        this._exportedObject.export(connection, OBJECT_PATH);
    }

    // D-Bus-facing method name, called by peachos-applauncher.desktop's Exec= via gdbus.
    Toggle() {
        this.toggle();
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
        this._loadApps();
        this._searchEntry.set_text('');

        this._root.visible = true;
        this._root.opacity = 0;
        this._root.remove_all_transitions();
        this._root.ease({
            opacity: 255,
            duration: FADE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._searchEntry.grab_key_focus();
        this._capturedEventId = global.stage.connect('captured-event', this._onCapturedEvent.bind(this));
    }

    close() {
        if (!this._open)
            return;
        this._open = false;

        this._root.remove_all_transitions();
        this._root.ease({
            opacity: 0,
            duration: FADE_DURATION,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                this._root.visible = false;
            },
        });

        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    }

    _onCapturedEvent(_actor, event) {
        if (event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._root.set_position(monitor.x, monitor.y);
        this._root.set_size(monitor.width, monitor.height);
        this._dim.set_position(0, 0);
        this._dim.set_size(monitor.width, monitor.height);
    }

    _loadApps() {
        this._allApps = Gio.AppInfo.get_all()
            .filter(app => app.should_show())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        this._buildPages(this._allApps);
    }

    _onSearchChanged() {
        const query = this._searchEntry.get_text().trim().toLowerCase();
        const apps = query
            ? this._allApps.filter(app => app.get_name().toLowerCase().includes(query))
            : this._allApps;
        this._buildPages(apps);
    }

    _buildPages(apps) {
        this._pagesBox.remove_all_children();
        this._dotsBox.remove_all_children();
        this._pages = [];

        const perPage = COLUMNS * ROWS;
        const pageCount = Math.max(1, Math.ceil(apps.length / perPage));

        for (let p = 0; p < pageCount; p++) {
            const pageApps = apps.slice(p * perPage, (p + 1) * perPage);
            const page = new St.Widget({
                layout_manager: new Clutter.GridLayout(),
                width: COLUMNS * CELL_WIDTH,
                height: ROWS * CELL_HEIGHT,
            });
            const grid = page.layout_manager;
            pageApps.forEach((appInfo, i) => {
                grid.attach(this._createAppTile(appInfo), i % COLUMNS, Math.floor(i / COLUMNS), 1, 1);
            });
            this._pagesBox.add_child(page);
            this._pages.push(page);

            const dot = new St.Widget({style_class: 'macos-applauncher-dot', reactive: true});
            const pageIndex = p;
            dot.connect('button-press-event', () => {
                this._goToPage(pageIndex);
                return Clutter.EVENT_STOP;
            });
            this._dotsBox.add_child(dot);
        }

        this._dotsBox.visible = pageCount > 1;
        this._page = 0;
        this._pagesBox.remove_all_transitions();
        this._pagesBox.translation_x = 0;
        this._updateDots();
    }

    _createAppTile(appInfo) {
        const tile = new St.Button({
            style_class: 'macos-applauncher-tile',
            width: CELL_WIDTH,
            height: CELL_HEIGHT,
        });
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            spacing: 6,
        });
        box.add_child(new St.Icon({gicon: appInfo.get_icon(), icon_size: ICON_SIZE}));
        box.add_child(new St.Label({
            text: appInfo.get_name(),
            style_class: 'macos-applauncher-label',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        tile.set_child(box);
        tile.connect('clicked', () => {
            this.close();
            appInfo.launch([], null);
        });
        return tile;
    }

    _goToPage(index) {
        this._page = Math.max(0, Math.min(this._pages.length - 1, index));
        this._pagesBox.remove_all_transitions();
        this._pagesBox.ease({
            translation_x: -this._page * COLUMNS * CELL_WIDTH,
            duration: PAGE_SLIDE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._updateDots();
    }

    _updateDots() {
        this._dotsBox.get_children().forEach((dot, i) => {
            if (i === this._page)
                dot.add_style_class_name('active');
            else
                dot.remove_style_class_name('active');
        });
    }

    _onScroll(_actor, event) {
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.LEFT) {
            this._goToPage(this._page - 1);
            return Clutter.EVENT_STOP;
        }
        if (direction === Clutter.ScrollDirection.RIGHT) {
            this._goToPage(this._page + 1);
            return Clutter.EVENT_STOP;
        }
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            // Real two-finger touchpad swipes arrive as SMOOTH scroll events with a
            // continuous delta, not discrete LEFT/RIGHT -- accumulate horizontal delta
            // until it crosses the threshold, then page and reset.
            const [dx] = event.get_scroll_delta();
            this._scrollAccum += dx;
            if (this._scrollAccum > SWIPE_THRESHOLD) {
                this._scrollAccum = 0;
                this._goToPage(this._page + 1);
            } else if (this._scrollAccum < -SWIPE_THRESHOLD) {
                this._scrollAccum = 0;
                this._goToPage(this._page - 1);
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        if (this._exportedObject) {
            this._exportedObject.flush();
            this._exportedObject.unexport();
            this._exportedObject = null;
        }
        Main.layoutManager.removeChrome(this._root);
        this._root.destroy();
        this._root = null;
    }
}
