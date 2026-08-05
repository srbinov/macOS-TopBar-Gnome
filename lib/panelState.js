/**
 * @param {{get_children: () => object[]}} box
 * @returns {{actor: object, visible: boolean}[]}
 */
export function snapshotBox(box) {
    return box.get_children().map(actor => ({actor, visible: actor.visible}));
}

/**
 * @param {{get_children: () => object[], remove_child: (actor: object) => void}} box
 */
export function clearBox(box) {
    for (const actor of box.get_children())
        box.remove_child(actor);
}

/**
 * Restores a box to contain the originally-snapshotted actors, in their
 * original order. Does NOT touch actor.visible: GNOME Shell's own session-mode
 * handling (e.g. hiding stock indicators on the lock screen) may have changed
 * visibility since the snapshot was taken, and blindly writing back the
 * pre-snapshot value would fight that and un-hide things GNOME deliberately
 * hid. Any actor present in the box at restore time that was NOT part of the
 * original snapshot (e.g. a panel button some other extension added while
 * this extension was enabled) is preserved and re-appended after the
 * restored originals, rather than being silently dropped.
 *
 * @param {{get_children: () => object[], remove_child: (actor: object) => void, add_child: (actor: object) => void}} box
 * @param {{actor: object, visible: boolean}[]} snapshot
 */
export function restoreBox(box, snapshot) {
    const known = new Set(snapshot.map(s => s.actor));
    const extra = box.get_children().filter(actor => !known.has(actor));

    clearBox(box);
    for (const {actor} of snapshot)
        box.add_child(actor);
    for (const actor of extra)
        box.add_child(actor);
}
