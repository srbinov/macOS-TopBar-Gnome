// lib/controlCenterIndicator.js
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {WifiTileController} from './wifiTileController.js';
import {BluetoothController} from './bluetoothController.js';
import {ScreenMirroringController} from './screenMirroringController.js';
import {FocusController} from './focusController.js';
import {BrightnessController} from './brightnessController.js';
import {VolumeController} from './volumeController.js';
import {MediaPlayerController} from './mediaPlayerController.js';

export const ControlCenterIndicator = GObject.registerClass(
class ControlCenterIndicator extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.5, 'Control Center');

        const iconPath = GLib.build_filenamev([extensionPath, 'icons', 'panel', 'control-center-white.png']);
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            icon_size: 16,
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();

        this._wifi = new WifiTileController(state => this._updateWifi(state));
        this._bluetooth = new BluetoothController(state => this._updateBluetooth(state));
        this._screenMirroring = new ScreenMirroringController(state => this._updateScreenMirroring(state));
        this._focus = new FocusController(state => this._updateFocus(state));

        this._brightness = new BrightnessController(state => this._updateBrightness(state));
        this._volume = new VolumeController(state => this._updateVolume(state));

        this._media = new MediaPlayerController(state => this._updateMedia(state));

        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenMirroring.destroy();
            this._focus.destroy();
            this._brightness.destroy();
            this._volume.destroy();
            this._media.destroy();
        });
    }

    _buildMenu() {
        this.menu.actor?.add_style_class_name('macos-control-center-menu');

        // Blurs the desktop/windows behind the popup itself (macOS-style
        // vibrancy), rather than any per-tile fake blur — tiles sit on top
        // of this one blurred layer, so a light tile background alone is
        // enough to read as "glass" without a second blur pass per tile.
        this.menu.actor?.add_effect(new Shell.BlurEffect({
            mode: Shell.BlurMode.BACKGROUND,
            radius: 30,
            brightness: 0.85,
        }));

        const root = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});

        this._container = new St.BoxLayout({
            vertical: true,
            style_class: 'macos-control-center-column',
            x_expand: true,
        });
        root.add_child(this._container);

        this._topRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        this._container.add_child(this._topRow);

        this._leftColumn = new St.BoxLayout({
            vertical: true,
            style_class: 'macos-control-center-column',
            x_expand: true,
            y_expand: true,
        });
        this._topRow.add_child(this._leftColumn);

        this._mediaCard = this._createMediaCard();
        this._topRow.add_child(this._mediaCard.actor);

        this._wifiPill = this._createPill('network-wireless-symbolic', 'Wi-Fi', '', () => this._wifi.toggle());
        this._leftColumn.add_child(this._wifiPill.actor);

        this._circleRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        this._leftColumn.add_child(this._circleRow);

        this._bluetoothCircle = this._createCircleButton('bluetooth-active-symbolic', () => this._bluetooth.toggle());
        this._circleRow.add_child(this._bluetoothCircle.button);

        this._mirrorCircle = this._createCircleButton('screen-shared-symbolic', () => this._screenMirroring.toggle());
        this._circleRow.add_child(this._mirrorCircle.button);

        this._focusPill = this._createPill('weather-clear-night-symbolic', 'Focus', '', () => this._focus.toggle());
        this._focusPill.actor.add_style_class_name('macos-control-center-focus-pill');
        this._container.add_child(this._focusPill.actor);

        this._displayCard = this._createSliderCard(
            'Display', 'display-brightness-symbolic', 'display-brightness-symbolic',
            percent => this._brightness.setPercent(percent));
        this._container.add_child(this._displayCard.actor);

        this._volumeCard = this._createSliderCard(
            'Volume', 'audio-volume-low-symbolic', 'audio-volume-high-symbolic',
            percent => this._volume.setPercent(percent));
        this._container.add_child(this._volumeCard.actor);

        this.menu.addMenuItem(root);
    }

    _createPill(iconName, title, subtitle, onActivate) {
        const button = new St.Button({
            style_class: 'macos-control-center-pill',
            reactive: true,
            can_focus: true,
            x_expand: true,
        });
        button.connect('clicked', onActivate);

        const content = new St.BoxLayout({style_class: 'macos-control-center-row'});
        button.set_child(content);

        const badge = new St.Bin({
            style_class: 'macos-control-center-pill-icon-badge',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        badge.set_child(new St.Icon({icon_name: iconName}));
        content.add_child(badge);

        const textColumn = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        content.add_child(textColumn);

        const titleLabel = new St.Label({text: title, style_class: 'macos-control-center-pill-title'});
        textColumn.add_child(titleLabel);

        const subtitleLabel = new St.Label({text: subtitle, style_class: 'macos-control-center-pill-subtitle'});
        textColumn.add_child(subtitleLabel);

        return {actor: button, titleLabel, subtitleLabel};
    }

    _createCircleButton(iconName, onActivate) {
        const button = new St.Button({
            style_class: 'macos-control-center-circle-button',
            reactive: true,
            can_focus: true,
        });
        button.connect('clicked', onActivate);

        const icon = new St.Icon({icon_name: iconName, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        button.set_child(icon);

        return {button, icon};
    }

    _createSliderCard(title, lowIconName, highIconName, onValueChanged) {
        const actor = new St.BoxLayout({vertical: true, style_class: 'macos-control-center-slider-card', x_expand: true});

        const titleLabel = new St.Label({text: title, style_class: 'macos-control-center-pill-title'});
        actor.add_child(titleLabel);

        const sliderRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        actor.add_child(sliderRow);

        const lowIcon = new St.Icon({icon_name: lowIconName, icon_size: 14, y_align: Clutter.ActorAlign.CENTER});
        sliderRow.add_child(lowIcon);

        const slider = new Slider(0);
        slider.x_expand = true;
        let suppressNotify = false;
        slider.connect('notify::value', () => {
            if (suppressNotify)
                return;
            onValueChanged(Math.round(slider.value * 100));
        });
        sliderRow.add_child(slider);

        const highIcon = new St.Icon({icon_name: highIconName, icon_size: 20, y_align: Clutter.ActorAlign.CENTER});
        sliderRow.add_child(highIcon);

        return {
            actor,
            slider,
            setValue: percent => {
                suppressNotify = true;
                slider.value = percent / 100;
                suppressNotify = false;
            },
        };
    }

    _createMediaCard() {
        const actor = new St.BoxLayout({
            vertical: true,
            style_class: 'macos-control-center-media-card',
            x_expand: true,
            y_expand: true,
        });

        const artBin = new St.Bin({style_class: 'macos-control-center-media-art'});
        artBin.clip_to_allocation = true;
        const artIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 28,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        artBin.set_child(artIcon);
        actor.add_child(artBin);

        const titleLabel = new St.Label({text: 'Nothing Playing', style_class: 'macos-control-center-media-title'});
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        actor.add_child(titleLabel);

        const artistLabel = new St.Label({text: '', style_class: 'macos-control-center-media-artist'});
        artistLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        actor.add_child(artistLabel);

        const transportRow = new St.BoxLayout({style_class: 'macos-control-center-media-transport', x_expand: true});
        actor.add_child(transportRow);

        const prevButton = this._createTransportButton('media-skip-backward-symbolic', () => this._media.previous());
        const playButton = this._createTransportButton('media-playback-start-symbolic', () => this._media.playPause());
        const nextButton = this._createTransportButton('media-skip-forward-symbolic', () => this._media.next());
        transportRow.add_child(prevButton.button);
        transportRow.add_child(playButton.button);
        transportRow.add_child(nextButton.button);

        return {actor, artIcon, titleLabel, artistLabel, prevButton, playButton, nextButton};
    }

    _createTransportButton(iconName, onActivate) {
        const button = new St.Button({style_class: 'macos-control-center-transport-button', reactive: true, can_focus: true});
        button.connect('clicked', onActivate);
        const icon = new St.Icon({icon_name: iconName, icon_size: 14, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        button.set_child(icon);
        return {button, icon};
    }

    _updateBrightness(state) {
        this._displayCard.setValue(state.percent);
    }

    _updateVolume(state) {
        this._volumeCard.setValue(state.percent);
    }

    _updateWifi(state) {
        this._wifiPill.subtitleLabel.text = state.statusLabel;
        if (state.enabled)
            this._wifiPill.actor.add_style_class_name('on');
        else
            this._wifiPill.actor.remove_style_class_name('on');
    }

    _updateBluetooth(state) {
        this._bluetoothCircle.button.tooltip_text = state.connectedDeviceName ?? '';
        if (state.powered)
            this._bluetoothCircle.button.add_style_class_name('on');
        else
            this._bluetoothCircle.button.remove_style_class_name('on');
    }

    _updateScreenMirroring(state) {
        if (state.enabled)
            this._mirrorCircle.button.add_style_class_name('on');
        else
            this._mirrorCircle.button.remove_style_class_name('on');
    }

    _updateFocus(state) {
        if (state.enabled)
            this._focusPill.actor.add_style_class_name('on');
        else
            this._focusPill.actor.remove_style_class_name('on');
    }

    _updateMedia(state) {
        this._mediaCard.titleLabel.text = state.isActive ? state.title : 'Nothing Playing';
        this._mediaCard.artistLabel.text = state.isActive ? state.artist : '';
        this._mediaCard.playButton.icon.icon_name = state.isPlaying
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._mediaCard.prevButton.button.reactive = state.isActive && state.canGoPrevious;
        this._mediaCard.nextButton.button.reactive = state.isActive && state.canGoNext;
        this._mediaCard.playButton.button.reactive = state.isActive && state.canTogglePlayback;

        if (state.artIcon) {
            this._mediaCard.artIcon.gicon = state.artIcon;
        } else {
            this._mediaCard.artIcon.gicon = null;
            this._mediaCard.artIcon.icon_name = 'audio-x-generic-symbolic';
        }
    }
});
