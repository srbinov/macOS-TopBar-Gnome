import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gvc from 'gi://Gvc';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {parseSoundState} from './soundData.js';

export const SoundIndicator = GObject.registerClass(
class SoundIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Sound');

        this._icon = new St.Icon({icon_name: 'audio-volume-muted-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._foreground = 'white';

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        // Same adjustable slider as the Control Center's own Volume tile
        // (controlCenterIndicator.js's _createSliderCard) -- just laid out as a plain
        // PopupBaseMenuItem row here instead of a liquid-glass card. activate: false is
        // the same "don't let the row's own click-to-close-menu gesture steal input"
        // convention menuManager.js already uses for its non-activating header rows --
        // the Slider is reactive on its own (its own PanGesture), it just can't get a
        // chance to see clicks/drags if the row underneath it is also grabbing them.
        this._sliderItem = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        this._sliderItem.add_style_class_name('macos-panel-slider-item');
        const lowIcon = new St.Icon({
            icon_name: 'audio-volume-low-symbolic', icon_size: 14,
            style_class: 'popup-menu-icon', y_align: Clutter.ActorAlign.CENTER,
        });
        this._sliderItem.add_child(lowIcon);
        this._volumeSlider = new Slider(0);
        this._volumeSlider.x_expand = true;
        this._sliderSuppressNotify = false;
        this._volumeSlider.connect('notify::value', () => {
            // !this._control guards against a real crash: destroy() nulls it out, but the
            // Slider actor itself isn't destroyed until later in the same teardown (it's a
            // child of this._sliderItem/this.menu, cleaned up by PanelMenu.Button's own
            // destroy chain) -- resetting its value as part of that teardown can still fire
            // this handler after this._control is already gone.
            if (this._sliderSuppressNotify || !this._stream || !this._control)
                return;
            const percent = Math.round(this._volumeSlider.value * 100);
            const maxVolume = this._control.get_vol_max_norm();
            this._stream.volume = Math.round((percent / 100) * maxVolume);
            this._stream.push_volume();
            if (percent > 0 && this._stream.is_muted)
                this._stream.change_is_muted(false);
        });
        this._sliderItem.add_child(this._volumeSlider);
        const highIcon = new St.Icon({
            icon_name: 'audio-volume-high-symbolic', icon_size: 18,
            style_class: 'popup-menu-icon', y_align: Clutter.ActorAlign.CENTER,
        });
        this._sliderItem.add_child(highIcon);
        this.menu.addMenuItem(this._sliderItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._muteItem = new PopupMenu.PopupSwitchMenuItem('Mute', false);
        this._muteItem.connect('toggled', (item, state) => {
            if (this._stream)
                this._stream.change_is_muted(state);
        });
        this.menu.addMenuItem(this._muteItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = new PopupMenu.PopupMenuItem('Sound Settings...');
        settingsItem.connect('activate', () => {
            Gio.Subprocess.new(['gnome-control-center', 'sound'], Gio.SubprocessFlags.NONE);
        });
        this.menu.addMenuItem(settingsItem);

        this.hide();

        this._stream = null;
        this._streamSignalIds = [];
        this._isDestroyed = false;

        this._control = new Gvc.MixerControl({name: 'macos-top-panel Volume Control'});
        this._control.connect('state-changed', () => this._onControlStateChanged());
        this._control.connect('default-sink-changed', () => this._readOutput());
        this._control.open();
        this._onControlStateChanged();

        this.connect('destroy', () => {
            this._isDestroyed = true;
            this._disconnectStream();
            this._control = null;
        });
    }

    _onControlStateChanged() {
        if (this._control.get_state() === Gvc.MixerControlState.READY)
            this._readOutput();
    }

    _readOutput() {
        this._disconnectStream();
        this._stream = this._control.get_default_sink();
        if (this._stream) {
            this._streamSignalIds.push(this._stream.connect('notify::volume', () => this._update()));
            this._streamSignalIds.push(this._stream.connect('notify::is-muted', () => this._update()));
        }
        this._update();
    }

    _disconnectStream() {
        if (this._stream) {
            for (const id of this._streamSignalIds)
                this._stream.disconnect(id);
        }
        this._streamSignalIds = [];
        this._stream = null;
    }

    _update() {
        if (this._isDestroyed)
            return;

        if (!this._stream) {
            this.hide();
            return;
        }

        this.show();
        const state = parseSoundState({
            muted: this._stream.is_muted,
            volume: this._stream.volume,
            maxVolume: this._control.get_vol_max_norm(),
        });

        this._icon.icon_name = state.icon;
        this._statusItem.label.text = state.statusLabel;
        this._muteItem.setToggleState(state.muted);

        this._sliderSuppressNotify = true;
        this._volumeSlider.value = state.percentage / 100;
        this._sliderSuppressNotify = false;
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
