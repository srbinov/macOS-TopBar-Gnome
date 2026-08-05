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

// restoreBox puts the original children back, in order, with original visibility,
// even if the box was cleared and populated with different actors first, and even
// if the recorded actors' visibility was mutated in the meantime.
{
    const a1 = new FakeActor('a', true);
    const a2 = new FakeActor('b', false);
    const box = new FakeBox([a1, a2]);
    const snap = snapshotBox(box);

    clearBox(box);
    box.add_child(new FakeActor('custom-1'));
    a1.visible = false; // simulate something toggling it while detached

    restoreBox(box, snap);

    assertEqual(box.get_children().map(c => c.name), ['a', 'b'], 'restoreBox order');
    assertEqual(box.get_children().map(c => c.visible), [true, false], 'restoreBox visibility restored from snapshot');
}

print('All panelState tests passed.');
