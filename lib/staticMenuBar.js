import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const LABELS = ['File', 'Edit', 'View', 'Window', 'Help'];

export const StaticMenuBar = GObject.registerClass(
class StaticMenuBar extends St.BoxLayout {
    _init() {
        super._init({style_class: 'macos-static-menu-bar'});

        for (const text of LABELS) {
            this.add_child(new St.Label({
                text,
                style_class: 'macos-static-menu-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
    }
});
