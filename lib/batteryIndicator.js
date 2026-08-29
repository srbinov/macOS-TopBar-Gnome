import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseBatteryState} from './batteryData.js';
import {drawBattery} from './batteryCanvas.js';

const UPOWER_BUS_NAME = 'org.freedesktop.UPower';
const DISPLAY_DEVICE_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const DISPLAY_DEVICE_IFACE = 'org.freedesktop.UPower.Device';

// Logical (1x) size of the drawn glyph -- matches batteryCanvas.js's own GLYPH_WIDTH/HEIGHT
// aspect ratio (22x13), scaled up slightly from that authoring size to read at the same
// visual weight the old 1.8em-icon-size PNG did next to the other panel icons.
const GLYPH_WIDTH = 25;
const GLYPH_HEIGHT = 15;

export const BatteryIndicator = GObject.registerClass(
class BatteryIndicator extends PanelMenu.Button {
    _init(extensionPath, settings) {
        super._init(0.5, 'Battery');

        this._extensionPath = extensionPath;
        this._settings = settings ?? null;
        this._foreground = 'white';
        this._state = {percentage: 0, charging: false};

        this._icon = new St.DrawingArea({
            style_class: 'system-status-icon macos-battery-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon.set_size(GLYPH_WIDTH, GLYPH_HEIGHT);
        this._icon.connect('repaint', area => this._repaintIcon(area));

        // panel-button-label: same class the clock and per-app menu labels (File/Edit/...)
        // share -- see clockWidget.js and menuManager.js. This label previously had no
        // style_class at all, so it fell back to St.Label's own default size/weight instead
        // of the panel's, which is why it looked oversized/misaligned next to everything
        // else. It also has nothing to do with the icon's size: icon-size only affects the
        // St.Icon sibling, but bumping the icon up (see .macos-battery-icon) happened at the
        // same time this went unnoticed, which is likely why the two looked connected.
        this._label = new St.Label({
            text: '',
            style_class: 'macos-battery-label panel-button-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const box = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
        // Label first, icon second: percentage reads to the LEFT of the icon, matching
        // real macOS -- it used to be icon-then-label (percentage on the right).
        box.add_child(this._label);
        box.add_child(this._icon);
        this.add_child(box);

        this._menuItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._menuItem);

        this.hide();

        this._proxy = null;
        this._propsChangedId = 0;
        this._isDestroyed = false;
        this._settingsChangedId = this._settings?.connect('changed', (_settings, key) => {
            if (key === 'battery-show-percentage' || key === 'show-battery-icon')
                this._update();
        }) ?? 0;
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
            if (this._settings && this._settingsChangedId)
                this._settings.disconnect(this._settingsChangedId);
            this._settings = null;
        });
    }

    _repaintIcon(area) {
        const [widthPx, heightPx] = area.get_surface_size();
        const cr = area.get_context();
        try {
            drawBattery(cr, widthPx, heightPx, {
                percentage: this._state.percentage,
                charging: this._state.charging,
                foreground: this._foreground,
            });
        } finally {
            cr.$dispose();
        }
    }

    /**
     * @param {'black'|'white'} foreground
     */
    setForeground(foreground) {
        if (foreground !== 'black' && foreground !== 'white')
            return;
        if (this._foreground === foreground)
            return;
        this._foreground = foreground;
        this._label.style = `color: ${foreground};`;
        this._icon.queue_repaint();
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
        const showIcon = this._settings?.get_boolean('show-battery-icon') ?? true;

        if (!state.hasBattery || !showIcon) {
            this.hide();
            return;
        }

        this.show();
        const showPercentage = this._settings?.get_boolean('battery-show-percentage') ?? true;
        this._label.text = showPercentage ? `${state.percentage}%` : '';
        this._state = {percentage: state.percentage, charging: state.charging};
        this._icon.queue_repaint();
        this._menuItem.label.text = state.statusLabel;
    }
});
