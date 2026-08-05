import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseBatteryState} from './batteryData.js';

const UPOWER_BUS_NAME = 'org.freedesktop.UPower';
const DISPLAY_DEVICE_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const DISPLAY_DEVICE_IFACE = 'org.freedesktop.UPower.Device';

export const BatteryIndicator = GObject.registerClass(
class BatteryIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Battery');

        this._icon = new St.Icon({icon_name: 'battery-symbolic', style_class: 'system-status-icon'});
        this._label = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        const box = new St.BoxLayout();
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._menuItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._menuItem);

        this.hide();

        this._proxy = null;
        this._propsChangedId = 0;
        this._isDestroyed = false;
        Gio.DBusProxy.new(
            Gio.DBus.system, Gio.DBusProxyFlags.NONE, null,
            UPOWER_BUS_NAME, DISPLAY_DEVICE_PATH, DISPLAY_DEVICE_IFACE, null,
            (source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_finish(result);
                    // The indicator may already have been destroyed (e.g. the
                    // extension was disabled) while this async call was still
                    // in flight. Bail out before touching the actor or
                    // wiring up a signal handler that would outlive it.
                    if (this._isDestroyed)
                        return;
                    this._proxy = proxy;
                    this._propsChangedId = this._proxy.connect('g-properties-changed', () => this._update());
                    this._update();
                } catch (e) {
                    logError(e, '[macos-top-panel] failed to connect to UPower');
                }
            });

        this.connect('destroy', () => {
            this._isDestroyed = true;
            if (this._proxy && this._propsChangedId)
                this._proxy.disconnect(this._propsChangedId);
            this._proxy = null;
        });
    }

    _update() {
        if (!this._proxy)
            return;

        const props = {
            isPresent: this._proxy.get_cached_property('IsPresent')?.unpack() ?? false,
            percentage: this._proxy.get_cached_property('Percentage')?.unpack() ?? 0,
            state: this._proxy.get_cached_property('State')?.unpack() ?? 0,
            timeToEmpty: this._proxy.get_cached_property('TimeToEmpty')?.unpack() ?? 0,
            timeToFull: this._proxy.get_cached_property('TimeToFull')?.unpack() ?? 0,
        };

        const state = parseBatteryState(props);

        if (!state.hasBattery) {
            this.hide();
            return;
        }

        this.show();
        this._label.text = `${state.percentage}%`;
        this._icon.icon_name = state.charging ? 'battery-charging-symbolic' : 'battery-symbolic';
        this._menuItem.label.text = state.statusLabel;
    }
});
