/*
 * Hides the stock Quick Settings panel icons that duplicate this
 * extension's own BatteryIndicator/WifiIndicator (the wifi signal icon
 * and the battery percentage icon shown directly in the panel button).
 *
 * Detaches the actors from Quick Settings' own indicator box rather than
 * setting `.visible = false`: SystemIndicator re-derives its own
 * visibility from its children's `notify::visible` signals
 * (_syncIndicatorsVisible in quickSettings.js), so an external
 * `.visible = false` would get silently overwritten. Detaching sidesteps
 * that fight entirely and leaves the indicator's own DBus/proxy state
 * untouched, ready to reattach unchanged on disable().
 *
 * Does NOT touch the Quick Settings dropdown menu contents (Lock/Power/
 * Settings etc.) — those are separate actors added to `.menu`, not to
 * this indicator box.
 */
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class DuplicateIndicatorsController {
    constructor() {
        this._detached = [];

        const quickSettings = Main.panel.statusArea.quickSettings;
        this._detach(quickSettings?._network);
        this._detach(quickSettings?._system);
    }

    _detach(indicator) {
        const parent = indicator?.get_parent();
        if (!parent)
            return;

        const index = parent.get_children().indexOf(indicator);
        parent.remove_child(indicator);
        this._detached.push({indicator, parent, index});
    }

    destroy() {
        for (const {indicator, parent, index} of this._detached)
            parent.insert_child_at_index(indicator, index);
        this._detached = [];
    }
}
