import Gio from 'gi://Gio';

const SCHEMA_ID = 'org.gnome.desktop.notifications';
const KEY = 'show-banners';

// show-banners=true means banners ARE shown (DND off); false is the same key
// GNOME Shell's own Quick Settings "Do Not Disturb" toggle flips.
export class DndController {
    constructor(onChange) {
        this._onChange = onChange;
        this._settings = new Gio.Settings({schema_id: SCHEMA_ID});
        this._signalId = this._settings.connect(`changed::${KEY}`, () => this._update());
        this._update();
    }

    _update() {
        const dnd = !this._settings.get_boolean(KEY);
        this._onChange({dnd});
    }

    toggle() {
        const dnd = !this._settings.get_boolean(KEY);
        this._settings.set_boolean(KEY, dnd);
    }

    destroy() {
        if (this._settings && this._signalId)
            this._settings.disconnect(this._signalId);
        this._signalId = 0;
        this._settings = null;
    }
}
