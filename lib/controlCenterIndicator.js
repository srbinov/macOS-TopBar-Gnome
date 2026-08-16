// lib/controlCenterIndicator.js
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {WifiTileController} from './wifiTileController.js';
import {BluetoothController} from './bluetoothController.js';
import {ScreenshotController} from './screenshotController.js';
import {AppearanceController} from './appearanceController.js';
import {BrightnessController} from './brightnessController.js';
import {VolumeController} from './volumeController.js';
import {MediaPlayerController} from './mediaPlayerController.js';

const MEDIA_ART_SIZE = 72;
const CIRCLE_ICON_SIZE = 36;

export const ControlCenterIndicator = GObject.registerClass(
class ControlCenterIndicator extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.5, 'Control Center');
        this._extensionPath = extensionPath;
        this._appearanceFlipRunning = false;
        this._foreground = 'white';

        this._panelIconWhite = Gio.icon_new_for_string(
            GLib.build_filenamev([extensionPath, 'icons', 'panel', 'control-center-white.png']));
        this._panelIconBlack = Gio.icon_new_for_string(
            GLib.build_filenamev([extensionPath, 'icons', 'panel', 'control-center-black.png']));
        this._icon = new St.Icon({
            gicon: this._panelIconWhite,
            icon_size: 16,
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();

        this._wifi = new WifiTileController(state => this._updateWifi(state));
        this._bluetooth = new BluetoothController(state => this._updateBluetooth(state));
        this._screenshot = new ScreenshotController();
        this._appearance = new AppearanceController(state => this._updateAppearance(state));

        this._brightness = new BrightnessController(state => this._updateBrightness(state));
        this._volume = new VolumeController(state => this._updateVolume(state));

        this._media = new MediaPlayerController(state => this._updateMedia(state));

        this.connect('destroy', () => {
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenshot.destroy();
            this._appearance.destroy();
            this._brightness.destroy();
            this._volume.destroy();
            this._media.destroy();
        });
    }

    /**
     * Swap the panel-face PNG when the transparent bar needs dark-on-light chrome.
     * @param {'black'|'white'} foreground
     */
    setForeground(foreground) {
        if (foreground !== 'black' && foreground !== 'white')
            return;
        if (this._foreground === foreground)
            return;
        this._foreground = foreground;
        this._icon.gicon = foreground === 'black' ? this._panelIconBlack : this._panelIconWhite;
    }

    _buildMenu() {
        this.menu.actor?.add_style_class_name('macos-control-center-menu');
        // Theme paints the opaque plate on .popup-menu-content / this.menu.box;
        // tag the box so stylesheet can clear it without fighting specificity.
        this.menu.box?.add_style_class_name('macos-control-center-content');

        // Deliberately no Shell.BlurEffect on the popup: attaching BACKGROUND
        // blur to a BoxPointer crashes Clutter after screenshot UI closes
        // (paint with a null/destroyed actor). Translucent CSS tiles are enough.

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

        this._bluetoothPill = this._createPill('bluetooth-active-symbolic', 'Bluetooth', '', () => this._bluetooth.toggle());
        this._leftColumn.add_child(this._bluetoothPill.actor);

        this._circleRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        this._leftColumn.add_child(this._circleRow);

        const screenshotIcon = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'screenshot.png']));
        this._screenshotCircle = this._createCircleButton(screenshotIcon, () => {
            this._screenshot.open(() => this.menu.close());
        });
        this._circleRow.add_child(this._screenshotCircle.button);

        this._appearanceGiconLight = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'appearance.png']));
        this._appearanceGiconDark = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'appearance-dark.png']));
        this._appearanceCircle = this._createCircleButton(this._appearanceGiconLight, () => this._onAppearanceClicked());
        this._circleRow.add_child(this._appearanceCircle.button);

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
        button.set_pivot_point(0.5, 0.5);
        button.connect('clicked', () => this._animatePress(button, onActivate));

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

    _createCircleButton(iconNameOrGicon, onActivate) {
        const button = new St.Button({
            style_class: 'macos-control-center-circle-button',
            reactive: true,
            can_focus: true,
        });
        button.set_pivot_point(0.5, 0.5);
        button.connect('clicked', () => this._animatePress(button, onActivate));

        const iconProps = {
            icon_size: CIRCLE_ICON_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        };
        if (typeof iconNameOrGicon === 'string')
            iconProps.icon_name = iconNameOrGicon;
        else
            iconProps.gicon = iconNameOrGicon;

        const icon = new St.Icon(iconProps);
        icon.set_pivot_point(0.5, 0.5);
        button.set_child(icon);

        return {button, icon};
    }

    /**
     * Safe 2D press feedback. Avoid rotation_angle_y / actor effects — those
     * hit Clutter paint metas and abort gnome-shell (same class of crash as
     * the old popup BlurEffect).
     */
    _animatePress(actor, onActivate) {
        try {
            actor.remove_all_transitions();
            actor.set_pivot_point(0.5, 0.5);
            actor.ease({
                scale_x: 0.9,
                scale_y: 0.9,
                duration: 70,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    try {
                        onActivate?.();
                    } catch (e) {
                        logError(e, '[macos-top-panel] control center: click handler failed');
                    }
                    actor.ease({
                        scale_x: 1,
                        scale_y: 1,
                        duration: 160,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                },
            });
        } catch (e) {
            logError(e, '[macos-top-panel] control center: press animation failed');
            try {
                onActivate?.();
            } catch (e2) {
                logError(e2, '[macos-top-panel] control center: click handler failed');
            }
        }
    }

    _onAppearanceClicked() {
        if (this._appearanceFlipRunning)
            return;

        const icon = this._appearanceCircle.icon;
        this._appearanceFlipRunning = true;

        try {
            icon.remove_all_transitions();
            icon.set_pivot_point(0.5, 0.5);
            // Horizontal scale flip (2D) — not Y-axis rotation (3D paint crash).
            icon.ease({
                scale_x: 0.05,
                duration: 140,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    try {
                        this._appearance.toggle();
                    } catch (e) {
                        logError(e, '[macos-top-panel] control center: appearance toggle failed');
                    }
                    icon.ease({
                        scale_x: 1,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onComplete: () => {
                            this._appearanceFlipRunning = false;
                        },
                    });
                },
            });
        } catch (e) {
            this._appearanceFlipRunning = false;
            logError(e, '[macos-top-panel] control center: appearance flip failed');
            try {
                this._appearance.toggle();
            } catch (e2) {
                logError(e2, '[macos-top-panel] control center: appearance toggle failed');
            }
        }
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

        const artBin = new St.Bin({
            style_class: 'macos-control-center-media-art',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        artBin.clip_to_allocation = true;
        const artIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: MEDIA_ART_SIZE,
            x_expand: true,
            y_expand: true,
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
        this._bluetoothPill.subtitleLabel.text = state.statusLabel;
        if (state.powered)
            this._bluetoothPill.actor.add_style_class_name('on');
        else
            this._bluetoothPill.actor.remove_style_class_name('on');
    }

    _updateAppearance(state) {
        // Dark mode: swapped black-filtered glyph. Light mode: original art.
        this._appearanceCircle.icon.gicon = state.dark
            ? this._appearanceGiconDark
            : this._appearanceGiconLight;

        if (state.dark)
            this._appearanceCircle.button.add_style_class_name('on');
        else
            this._appearanceCircle.button.remove_style_class_name('on');
    }

    _updateMedia(state) {
        try {
            this._mediaCard.titleLabel.text = state.isActive ? String(state.title || '') : 'Nothing Playing';
            this._mediaCard.artistLabel.text = state.isActive ? String(state.artist || '') : '';
            this._mediaCard.playButton.icon.icon_name = state.isPlaying
                ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            this._mediaCard.prevButton.button.reactive = state.isActive && state.canGoPrevious;
            this._mediaCard.nextButton.button.reactive = state.isActive && state.canGoNext;
            this._mediaCard.playButton.button.reactive = state.isActive && state.canTogglePlayback;

            if (state.artIcon) {
                this._mediaCard.artIcon.gicon = state.artIcon;
                this._mediaCard.artIcon.icon_size = MEDIA_ART_SIZE;
            } else {
                this._mediaCard.artIcon.gicon = null;
                this._mediaCard.artIcon.icon_name = 'audio-x-generic-symbolic';
                this._mediaCard.artIcon.icon_size = 28;
            }
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to update media card');
        }
    }
});
