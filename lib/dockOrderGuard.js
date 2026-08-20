import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// GNOME's own dash.js _redisplay() acknowledges in its own comment that its diffing
// algorithm "assumes only one item is moved at a given time" and that touching several
// items at once can make it "remove all the launchers and add them back in a new order" --
// exactly what peachos-icon-appearance's bulk icon swap does (many apps' resolved
// GDesktopAppInfo change within the same second). There's no way to stop Shell's own
// dash.js from doing this from outside GNOME Shell; the only real fix is to snapshot the
// dock's actual on-screen app order before the change and force it back after, at the
// Clutter actor level -- which has to happen here, inside the Shell process, since that's
// the only place these actors actually live.
const BUS_NAME = 'org.peachos.DockOrderGuard';
const OBJECT_PATH = '/org/peachos/DockOrderGuard';
const IFACE_XML = `
<node>
  <interface name="${BUS_NAME}">
    <method name="Snapshot" />
    <method name="Restore" />
  </interface>
</node>`;

const DOCK_ACTOR_NAME = 'dashtodockContainer'; // dash2dock-lite's own name for its dock actor,
                                                // same constant lib/appLauncher.js uses

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

export class DockOrderGuard {
    constructor() {
        this._snapshot = null;
        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION, BUS_NAME, Gio.BusNameOwnerFlags.NONE,
            this._onBusAcquired.bind(this), null, null,
        );
    }

    _onBusAcquired(connection) {
        this._exportedObject = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this);
        this._exportedObject.export(connection, OBJECT_PATH);
    }

    _dashBox() {
        return Main.overview?.dash?._box ?? null;
    }

    // Same filter dash.js's own _redisplay() uses to isolate real app-icon children from
    // separators, dash2dock-lite's extra-icons (trash/downloads), and the show-apps icon.
    _appChildren(box) {
        return box.get_children().filter(actor => actor.child?._delegate?.app);
    }

    Snapshot() {
        const box = this._dashBox();
        this._snapshot = box ? this._appChildren(box).map(actor => actor.child._delegate.app.get_id()) : null;
    }

    Restore() {
        if (!this._snapshot)
            return;
        const box = this._dashBox();
        if (!box) {
            this._snapshot = null;
            return;
        }

        const byId = new Map();
        for (const actor of this._appChildren(box))
            byId.set(actor.child._delegate.app.get_id(), actor);

        let index = 0;
        for (const id of this._snapshot) {
            const actor = byId.get(id);
            if (!actor)
                continue; // no longer in the dash (uninstalled/unpinned in the meantime) -- skip
            box.set_child_at_index(actor, index);
            index++;
        }
        this._snapshot = null;

        // Reordering _box directly is invisible to dash2dock-lite: it renders from its own
        // this._icons cache (built by reading _box.get_children() once), only rebuilt on
        // Shell.AppSystem install/state-change or AppFavorites "changed" signals -- neither of
        // which set_child_at_index() fires. Its own actor registers itself under this name
        // (Dock's _init() sets `name: 'dashtodockContainer'` on the widget itself, no separate
        // delegate), so invalidating its cache and asking it to redraw is a direct, two-line
        // call once found -- far more surgical than touching gsettings to indirectly trigger
        // one of its real listened-to signals, which risks kicking off GNOME's own dash.js
        // _redisplay() and re-scrambling the very order this method just fixed.
        const dockActor = _findActorByName(Main.layoutManager.uiGroup, DOCK_ACTOR_NAME);
        if (dockActor && typeof dockActor._beginAnimation === 'function') {
            dockActor._icons = null;
            dockActor._beginAnimation();
        }
    }

    destroy() {
        this._snapshot = null;
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        if (this._exportedObject) {
            this._exportedObject.flush();
            this._exportedObject.unexport();
            this._exportedObject = null;
        }
    }
}
