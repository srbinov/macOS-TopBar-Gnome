import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {snapshotBox, clearBox, restoreBox} from './lib/panelState.js';
import {ClockWidget} from './lib/clockWidget.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        this._boxSnapshots = {
            left: snapshotBox(Main.panel._leftBox),
            center: snapshotBox(Main.panel._centerBox),
            right: snapshotBox(Main.panel._rightBox),
        };

        clearBox(Main.panel._leftBox);
        clearBox(Main.panel._centerBox);
        clearBox(Main.panel._rightBox);

        this._clockWidget = new ClockWidget();
        Main.panel._rightBox.add_child(this._clockWidget);
    }

    disable() {
        if (!this._boxSnapshots)
            return;

        this._clockWidget.destroy();
        this._clockWidget = null;

        restoreBox(Main.panel._leftBox, this._boxSnapshots.left);
        restoreBox(Main.panel._centerBox, this._boxSnapshots.center);
        restoreBox(Main.panel._rightBox, this._boxSnapshots.right);
        this._boxSnapshots = null;
    }
}
