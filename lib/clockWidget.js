import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {formatMacDate, formatMacTime} from './clockFormat.js';

export const ClockWidget = GObject.registerClass(
class ClockWidget extends St.BoxLayout {
    _init(settings, onActivate) {
        super._init({
            style_class: 'macos-clock',
            reactive: true,
            track_hover: true,
        });

        this._settings = settings ?? null;
        this._foreground = 'white';

        // Click anywhere on the clock (date or time label) toggles the Notification Center,
        // matching real macOS -- see lib/notificationCenter.js. onActivate is a plain
        // callback rather than this widget owning/importing NotificationCenterPanel itself,
        // same reasoning as every other indicator in this codebase: extension.js owns
        // lifecycle for anything that isn't purely this widget's own concern.
        if (onActivate) {
            this.connect('button-press-event', () => {
                onActivate();
                return Clutter.EVENT_STOP;
            });
        }

        // panel-button-label: the same class the per-app global menu labels (app name,
        // File/Edit/View/...) use -- see menuManager.js. Neither sets its own font-size or
        // font-weight; both just inherit the stock #panel rule's "font-weight: bold" and the
        // stage's default text size, which is already text-scaling-factor-aware natively.
        // This USED to compute its own inline pixel font-size (clock-font-size, manually
        // scaled by text-scaling-factor), which is exactly why it didn't match: two
        // independent sizing paths landing on two different numbers. Sharing the class and
        // *not* setting an inline font-size guarantees the same resolved value by
        // construction, rather than by trying to replicate it.
        this._dateLabel = new St.Label({
            style_class: 'macos-clock-date panel-button-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timeLabel = new St.Label({
            style_class: 'macos-clock-time panel-button-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._dateLabel);
        this.add_child(this._timeLabel);

        this._applyFont();
        this._settingsChangedId = this._settings?.connect('changed', (_settings, key) => {
            if (key === 'clock-font-family')
                this._applyFont();
            else if (key === 'clock-show-date' || key === 'clock-24-hour' || key === 'clock-show-seconds')
                this._update();
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

        // No font-size here on purpose -- see the comment on the labels' construction above.
        // family stays optional/opt-in: empty by default, matching the menu labels' own
        // family (inherited from #panel), but still overridable without affecting size/weight.
        const family = this._settings?.get_string('clock-font-family');

        const declarations = [];
        if (family)
            declarations.push(`font-family: "${family}"`);
        declarations.push(`color: ${this._foreground}`);

        const style = declarations.join('; ');
        this._dateLabel.style = style;
        this._timeLabel.style = style;
    }

    _update() {
        const now = new Date();
        const showDate = this._settings?.get_boolean('clock-show-date') ?? true;
        this._dateLabel.visible = showDate;
        if (showDate)
            this._dateLabel.text = formatMacDate(now);
        this._timeLabel.text = formatMacTime(now, {
            use24Hour: this._settings?.get_boolean('clock-24-hour') ?? false,
            showSeconds: this._settings?.get_boolean('clock-show-seconds') ?? false,
        });
    }
});
