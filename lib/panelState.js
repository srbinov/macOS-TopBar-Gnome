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
 * @param {{get_children: () => object[], remove_child: (actor: object) => void, add_child: (actor: object) => void}} box
 * @param {{actor: object, visible: boolean}[]} snapshot
 */
export function restoreBox(box, snapshot) {
    clearBox(box);
    for (const {actor, visible} of snapshot) {
        box.add_child(actor);
        actor.visible = visible;
    }
}
