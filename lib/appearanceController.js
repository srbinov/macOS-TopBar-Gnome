import Gio from 'gi://Gio';

const SCHEMA_ID = 'org.gnome.desktop.interface';
const KEY = 'color-scheme';
const DARK = 'prefer-dark';
const LIGHT = 'prefer-light';

export class AppearanceController {
    constructor(onChange) {
        this._onChange = onChange;
        this._settings = new Gio.Settings({schema_id: SCHEMA_ID});
        this._signalId = this._settings.connect(`changed::${KEY}`, () => this._update());
        this._update();
    }

    _update() {
        const scheme = this._settings.get_string(KEY);
        this._onChange({dark: scheme === DARK, scheme});
    }

    toggle() {
        const next = this._settings.get_string(KEY) === DARK ? LIGHT : DARK;
        this._settings.set_string(KEY, next);
    }

    destroy() {
        if (this._settings && this._signalId)
            this._settings.disconnect(this._signalId);
        this._signalId = 0;
        this._settings = null;
    }
}
