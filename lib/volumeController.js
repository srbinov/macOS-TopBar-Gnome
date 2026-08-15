import Gvc from 'gi://Gvc';

import {parseSoundState} from './soundData.js';

export class VolumeController {
    constructor(onChange) {
        this._onChange = onChange;
        this._stream = null;
        this._streamSignalIds = [];
        this._isDestroyed = false;

        this._control = new Gvc.MixerControl({name: 'macos-top-panel Control Center Volume'});
        this._control.connect('state-changed', () => this._onControlStateChanged());
        this._control.connect('default-sink-changed', () => this._readOutput());
        this._control.open();
        this._onControlStateChanged();
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
            this._onChange({percent: 0});
            return;
        }

        const state = parseSoundState({
            muted: this._stream.is_muted,
            volume: this._stream.volume,
            maxVolume: this._control.get_vol_max_norm(),
        });
        this._onChange({percent: state.percentage});
    }

    setPercent(percent) {
        if (!this._stream)
            return;

        const clamped = Math.max(0, Math.min(100, percent));
        const maxVolume = this._control.get_vol_max_norm();
        this._stream.volume = Math.round((clamped / 100) * maxVolume);
        this._stream.push_volume();

        if (clamped > 0 && this._stream.is_muted)
            this._stream.change_is_muted(false);
    }

    destroy() {
        this._isDestroyed = true;
        this._disconnectStream();
        this._control = null;
    }
}
