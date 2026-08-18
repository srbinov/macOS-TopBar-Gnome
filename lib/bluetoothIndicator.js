import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {BluetoothController} from './bluetoothController.js';

export const BluetoothIndicator = GObject.registerClass(
class BluetoothIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Bluetooth');

        this._icon = new St.Icon({icon_name: 'bluetooth-active-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._foreground = 'white';

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._statusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._toggleItem = new PopupMenu.PopupSwitchMenuItem('Bluetooth', false);
        this._toggleItem.connect('toggled', () => this._controller.toggle());
        this.menu.addMenuItem(this._toggleItem);

        this._controller = new BluetoothController(state => this._update(state));

        this.connect('destroy', () => {
            this._controller.destroy();
        });
    }

    _update(state) {
        this._icon.icon_name = state.powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
        this._statusItem.label.text = state.statusLabel;
        this._toggleItem.setToggleState(state.powered);
    }

    /**
     * @param {'black'|'white'} foreground
     */
    setForeground(foreground) {
        if (foreground !== 'black' && foreground !== 'white')
            return;
        this._foreground = foreground;
        this._icon.style = `color: ${foreground};`;
    }
});
