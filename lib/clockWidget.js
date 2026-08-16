import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {formatMacDate, formatMacTime} from './clockFormat.js';

export const ClockWidget = GObject.registerClass(
class ClockWidget extends St.BoxLayout {
    _init(settings) {
        super._init({style_class: 'macos-clock'});

        this._settings = settings ?? null;
        this._foreground = 'white';

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

        this._applyFont();
        this._settingsChangedId = this._settings?.connect('changed', (_settings, key) => {
            if (key === 'clock-font-family' || key === 'clock-font-size')
                this._applyFont();
        }) ?? 0;

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
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }
            this._settings = null;
        });
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
        this._applyFont();
    }

    _applyFont() {
        if (!this._settings && !this._foreground)
            return;

        const family = this._settings?.get_string('clock-font-family');
        const size = this._settings?.get_int('clock-font-size');

        const declarations = [];
        if (family)
            declarations.push(`font-family: "${family}"`);
        if (size > 0)
            declarations.push(`font-size: ${size}px`);
        declarations.push(`color: ${this._foreground}`);

        const style = declarations.join('; ');
        this._dateLabel.style = style;
        this._timeLabel.style = style;
    }

    _update() {
        const now = new Date();
        this._dateLabel.text = formatMacDate(now);
        this._timeLabel.text = formatMacTime(now);
    }
});
