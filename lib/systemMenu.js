import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

export const AppleMenuButton = GObject.registerClass(
class AppleMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Apple Menu');

        this.add_child(new St.Label({text: '', style_class: 'macos-apple-glyph'}));

        const aboutItem = new PopupMenu.PopupMenuItem('About This Computer');
        aboutItem.connect('activate', () => this._showAbout());
        this.menu.addMenuItem(aboutItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings…');
        settingsItem.connect('activate', () => {
            Gio.Subprocess.new(['gnome-control-center'], Gio.SubprocessFlags.NONE);
        });
        this.menu.addMenuItem(settingsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const actions = SystemActions.getDefault();
        const actionItems = [
            ['Lock Screen', () => actions.activateLockScreen()],
            ['Suspend', () => actions.activateSuspend()],
            ['Restart…', () => actions.activateRestart()],
            ['Shut Down…', () => actions.activatePowerOff()],
            ['Log Out…', () => actions.activateLogout()],
        ];
        for (const [label, callback] of actionItems) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', callback);
            this.menu.addMenuItem(item);
        }
    }

    _showAbout() {
        const osName = GLib.get_os_info('PRETTY_NAME') ?? 'Unknown OS';
        const hostName = GLib.get_host_name();
        Main.notify('About This Computer', `${osName}\n${hostName}`);
    }
});
