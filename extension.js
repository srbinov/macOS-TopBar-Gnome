import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MacosTopPanelExtension extends Extension {
    enable() {
        console.log('[macos-top-panel] enable() called');
    }

    disable() {
        console.log('[macos-top-panel] disable() called');
    }
}
