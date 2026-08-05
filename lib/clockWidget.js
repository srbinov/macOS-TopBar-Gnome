import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {formatMacDate, formatMacTime} from './clockFormat.js';

export const ClockWidget = GObject.registerClass(
class ClockWidget extends St.BoxLayout {
    _init() {
        super._init({style_class: 'macos-clock'});

        this._dateLabel = new St.Label({
            style_class: 'macos-clock-date',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timeLabel = new St.Label({
            style_class: 'macos-clock-time',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._dateLabel);
        this.add_child(this._timeLabel);

        this._update();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('destroy', () => {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = null;
            }
        });
    }

    _update() {
        const now = new Date();
        this._dateLabel.text = formatMacDate(now);
        this._timeLabel.text = formatMacTime(now);
    }
});
