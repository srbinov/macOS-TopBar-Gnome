import {snapshotBox, clearBox, restoreBox} from '../lib/panelState.js';

class FakeActor {
    constructor(name, visible = true) {
        this.name = name;
        this.visible = visible;
    }
}

class FakeBox {
    constructor(children) {
        this._children = children;
    }
    get_children() {
        return this._children.slice();
    }
    add_child(actor) {
        this._children.push(actor);
    }
    remove_child(actor) {
        this._children = this._children.filter(c => c !== actor);
    }
}

function assertEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`FAIL: ${msg}\n  expected: ${e}\n  actual:   ${a}`);
    print(`PASS: ${msg}`);
}

// snapshotBox captures actor + visibility for each child, in order
{
    const a1 = new FakeActor('a', true);
    const a2 = new FakeActor('b', false);
    const box = new FakeBox([a1, a2]);
    const snap = snapshotBox(box);
    assertEqual(snap.map(s => s.actor.name), ['a', 'b'], 'snapshotBox order');
    assertEqual(snap.map(s => s.visible), [true, false], 'snapshotBox visibility');
}

// clearBox empties the box
{
    const box = new FakeBox([new FakeActor('a'), new FakeActor('b')]);
    clearBox(box);
    assertEqual(box.get_children().length, 0, 'clearBox empties children');
}

// restoreBox puts the original children back, in order, even after the box
// was cleared in between. It does NOT touch actor.visible: whatever
// visibility the actor currently has (which may have been changed by
// something else, e.g. GNOME Shell's own lock-screen handling) is left alone
// rather than being forced back to the snapshot's recorded value.
{
    const a1 = new FakeActor('a', true);
    const a2 = new FakeActor('b', false);
    const box = new FakeBox([a1, a2]);
    const snap = snapshotBox(box);

    clearBox(box);
    a1.visible = false; // simulate something else toggling it while detached
    a2.visible = true;

    restoreBox(box, snap);

    assertEqual(box.get_children().map(c => c.name), ['a', 'b'], 'restoreBox order');
    assertEqual(box.get_children().map(c => c.visible), [false, true], 'restoreBox leaves visibility untouched (not forced back to snapshot)');
}

// restoreBox preserves a "foreign" actor that was added to the box (by some
// other extension) after snapshotBox was called — it must not be silently
// dropped by the clearBox/re-add cycle, even though it isn't part of the
// snapshot. It's appended after the restored originals.
{
    const a1 = new FakeActor('a', true);
    const a2 = new FakeActor('b', false);
    const box = new FakeBox([a1, a2]);
    const snap = snapshotBox(box);

    const foreign = new FakeActor('foreign-appindicator', true);
    box.add_child(foreign); // e.g. ubuntu-appindicators adding a tray icon

    restoreBox(box, snap);

    assertEqual(box.get_children().map(c => c.name), ['a', 'b', 'foreign-appindicator'], 'restoreBox preserves foreign actors, appended after originals');
}

print('All panelState tests passed.');
