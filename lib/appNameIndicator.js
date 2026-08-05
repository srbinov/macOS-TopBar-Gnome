import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const AppNameButton = GObject.registerClass(
class AppNameButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'App Name');

        this._label = new St.Label({text: '', style_class: 'macos-app-name', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._label);

        const quitItem = new PopupMenu.PopupMenuItem('Quit');
        quitItem.connect('activate', () => this._quitFocusedApp());
        this.menu.addMenuItem(quitItem);

        const hideItem = new PopupMenu.PopupMenuItem('Hide');
        hideItem.connect('activate', () => this._hideFocusedApp());
        this.menu.addMenuItem(hideItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const aboutItem = new PopupMenu.PopupMenuItem('About');
        aboutItem.connect('activate', () => this._aboutFocusedApp());
        this.menu.addMenuItem(aboutItem);

        this._tracker = Shell.WindowTracker.get_default();
        this._focusAppChangedId = this._tracker.connect('notify::focus-app', () => this._update());
        this._update();

        this.connect('destroy', () => {
            this._tracker.disconnect(this._focusAppChangedId);
        });
    }

    _update() {
        const app = this._tracker.focus_app;
        this._label.text = app ? app.get_name() : '';
    }

    _quitFocusedApp() {
        const win = global.display.focus_window;
        if (win)
            win.delete(global.get_current_time());
    }

    _hideFocusedApp() {
        const win = global.display.focus_window;
        if (win)
            win.minimize();
    }

    _aboutFocusedApp() {
        const app = this._tracker.focus_app;
        if (app)
            Main.notify(app.get_name(), 'No further details available.');
    }
});
