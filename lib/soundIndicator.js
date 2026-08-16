import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gvc from 'gi://Gvc';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

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
