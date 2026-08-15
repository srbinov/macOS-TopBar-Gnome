import Gio from 'gi://Gio';

const SCHEMA_ID = 'org.gnome.desktop.notifications';
const KEY = 'show-banners';

export class FocusController {
    constructor(onChange) {
        this._onChange = onChange;
        this._settings = new Gio.Settings({schema_id: SCHEMA_ID});
        this._signalId = this._settings.connect(`changed::${KEY}`, () => this._update());
        this._update();
    }

    _update() {
        // Focus is "on" exactly when notification banners are suppressed.
        this._onChange({enabled: !this._settings.get_boolean(KEY)});
    }

    toggle() {
        this._settings.set_boolean(KEY, !this._settings.get_boolean(KEY));
    }

    destroy() {
        if (this._settings && this._signalId)
            this._settings.disconnect(this._signalId);
        this._signalId = 0;
        this._settings = null;
    }
}
