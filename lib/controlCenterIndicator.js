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
import {DndController} from './dndController.js';
import {TileBlurController} from './tileBlurController.js';
import {BackgroundAdaptiveController} from './backgroundAdaptiveController.js';
import {ControlCenterGlass} from './controlCenterGlass.js';
import {shouldUseDarkContent} from './liquidGlassIntensity.js';

const PANEL_SCHEMA_ID = 'org.gnome.shell.extensions.macos-top-panel';
const INTERFACE_SCHEMA_ID = 'org.gnome.desktop.interface';

const CONTROL_CENTER_MENU_WIDTH = 262; // matches .macos-control-center-menu in stylesheet.css

const CLOCKS_STATE_SCHEMA_ID = 'org.gnome.clocks.state.window';
const TEXT_EDITOR_NEW_WINDOW_CMD =
    ['flatpak', 'run', '--branch=stable', '--arch=x86_64', '--command=gnome-text-editor',
        'org.gnome.TextEditor', '--new-window'];

const MEDIA_ART_SIZE = 48; // matches .macos-control-center-media-art in stylesheet.css
// This icon_size is set directly on the St.Icon in JS (below), which wins over the CSS
// icon-size rule for the same class -- editing the CSS alone previously did nothing, the
// icon stayed 36px while only the outer button shrank, so it filled a *larger* share of a
// smaller circle (and looked even more so once screenshot.png went from low-contrast blue
// to solid white) -- this is the actual, only place that controls it.
const CIRCLE_ICON_SIZE = 20; // 30% smaller than 29 -- circle-button diameter (51px) is unchanged

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

        this._tileBlur = new TileBlurController();
        this._backgroundAdaptive = new BackgroundAdaptiveController(() => this._getBackgroundSamplePoint());
        // Liquid Glass intensity slider (Settings -> Appearance -> Liquid Glass): a
        // supplementary-stylesheet-reload controller, not plain inline `.style` on these
        // tiles -- see controlCenterGlass.js's own docstring for why that approach broke
        // :hover/.on across the whole Control Center.
        this._controlCenterGlass = new ControlCenterGlass();

        // Own, self-contained Gio.Settings (matches ControlCenterGlass's own pattern)
        // rather than sharing an instance with it -- this only needs to swap the
        // pre-baked-PNG icons that CSS can't reach (see _applyIconTint()'s own doc), not
        // regenerate a whole stylesheet, so keeping the two concerns in separate objects
        // that each own their own settings lifecycle is simpler than threading one
        // through both.
        this._panelSettings = new Gio.Settings({schema_id: PANEL_SCHEMA_ID});
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA_ID});
        this._iconTintSettingsChangedId = this._panelSettings.connect(
            'changed::liquid-glass-intensity', () => this._applyIconTint());
        this._iconTintColorSchemeChangedId = this._interfaceSettings.connect(
            'changed::color-scheme', () => this._applyIconTint());

        this._buildMenu();
        this._applyIconTint();

        // Blur only exists while the menu is actually open, and is stripped the instant
        // closing starts -- see tileBlurController.js for why (crash history). The adaptive
        // light/dark glass check runs once per open for the same reason a fresh sample is
        // pointless while closed, and resets to the default look when closing starts too.
        this._openStateId = this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._tileBlur.enable();
                this._backgroundAdaptive.sample().catch(e =>
                    logError(e, '[macos-top-panel] control center: background sample failed'));
            } else {
                this._tileBlur.disable();
                this._backgroundAdaptive.reset();
            }
        });

        this._wifi = new WifiTileController(state => this._updateWifi(state));
        this._bluetooth = new BluetoothController(state => this._updateBluetooth(state));
        this._screenshot = new ScreenshotController();
        this._appearance = new AppearanceController(state => this._updateAppearance(state));

        this._brightness = new BrightnessController(state => this._updateBrightness(state));
        this._volume = new VolumeController(state => this._updateVolume(state));

        this._media = new MediaPlayerController(state => this._updateMedia(state));
        this._dnd = new DndController(state => this._updateDnd(state));

        this.connect('destroy', () => {
            if (this._openStateId) {
                this.menu.disconnect(this._openStateId);
                this._openStateId = 0;
            }
            this._tileBlur.destroy();
            this._backgroundAdaptive.destroy();
            this._controlCenterGlass.destroy();
            if (this._iconTintSettingsChangedId) {
                this._panelSettings.disconnect(this._iconTintSettingsChangedId);
                this._iconTintSettingsChangedId = 0;
            }
            if (this._iconTintColorSchemeChangedId) {
                this._interfaceSettings.disconnect(this._iconTintColorSchemeChangedId);
                this._iconTintColorSchemeChangedId = 0;
            }
            this._wifi.destroy();
            this._bluetooth.destroy();
            this._screenshot.destroy();
            this._appearance.destroy();
            this._brightness.destroy();
            this._volume.destroy();
            this._media.destroy();
            this._dnd.destroy();
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

        // Deliberately no Shell.BlurEffect on the popup/BoxPointer itself: that crashes
        // Clutter after screenshot UI closes (paint with a null/destroyed actor). Individual
        // glass tiles get their own blur instead, via this._tileBlur -- see
        // tileBlurController.js for the crash-safe lifecycle (register() calls below).

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
        this._tileBlur.register(this._mediaCard.actor);
        this._backgroundAdaptive.register(this._mediaCard.actor);
        this._topRow.add_child(this._mediaCard.actor);

        this._wifiPill = this._createPill('network-wireless-symbolic', 'Wi-Fi', '', () => this._wifi.toggle());
        this._tileBlur.register(this._wifiPill.actor);
        this._backgroundAdaptive.register(this._wifiPill.actor);
        this._leftColumn.add_child(this._wifiPill.actor);

        this._bluetoothPill = this._createPill('bluetooth-active-symbolic', 'Bluetooth', '', () => this._bluetooth.toggle());
        this._tileBlur.register(this._bluetoothPill.actor);
        this._backgroundAdaptive.register(this._bluetoothPill.actor);
        this._leftColumn.add_child(this._bluetoothPill.actor);

        // NOT nested in leftColumn: 4 circles need the full 4-circle-row width (234px),
        // which is wider than the wifi/bluetooth+media half-column below -- nesting it
        // there forced that whole column (and the pills in it) to stretch to match.
        this._circleRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        this._container.add_child(this._circleRow);

        this._screenshotGiconLight = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'screenshot.png']));
        this._screenshotGiconDark = Gio.icon_new_for_string(GLib.build_filenamev(
            [this._extensionPath, 'icons', 'control-center', 'screenshot-lowglass-dark.png']));
        this._screenshotCircle = this._createCircleButton(this._screenshotGiconLight, () => {
            // Belt-and-suspenders: also strip blur here directly, before even closing the
            // menu, rather than relying solely on the open-state-changed handler's timing.
            this._tileBlur.disable();
            this._backgroundAdaptive.reset();
            this._screenshot.open(() => this.menu.close());
        });
        this._tileBlur.register(this._screenshotCircle.button);
        this._backgroundAdaptive.register(this._screenshotCircle.button);
        this._circleRow.add_child(this._screenshotCircle.button);

        this._appearanceGiconLight = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'appearance.png']));
        this._appearanceGiconDark = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'appearance-dark.png']));
        // Distinct from appearanceGiconDark above -- that one is a different *icon*
        // (crescent-vs-sun-ish shape, shown when the system itself is in dark mode).
        // This is the same light-mode icon shape, just dark-TINTED, shown instead of it
        // only when low Liquid Glass in light mode would otherwise wash it out.
        this._appearanceGiconLowglassDark = Gio.icon_new_for_string(GLib.build_filenamev(
            [this._extensionPath, 'icons', 'control-center', 'appearance-lowglass-dark.png']));
        this._appearanceCircle = this._createCircleButton(this._appearanceGiconLight, () => this._onAppearanceClicked());
        this._tileBlur.register(this._appearanceCircle.button);
        this._backgroundAdaptive.register(this._appearanceCircle.button);
        this._circleRow.add_child(this._appearanceCircle.button);

        this._airdropGiconLight = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'airdrop.png']));
        this._airdropGiconDark = Gio.icon_new_for_string(GLib.build_filenamev(
            [this._extensionPath, 'icons', 'control-center', 'airdrop-lowglass-dark.png']));
        this._airdropCircle = this._createCircleButton(this._airdropGiconLight, () => {
            Gio.Subprocess.new(['localsend_app'], Gio.SubprocessFlags.NONE);
            this.menu.close();
        });
        this._tileBlur.register(this._airdropCircle.button);
        this._backgroundAdaptive.register(this._airdropCircle.button);
        this._circleRow.add_child(this._airdropCircle.button);

        this._logoutCircle = this._createCircleButton('system-log-out-symbolic', () => {
            Gio.Subprocess.new(['gnome-session-quit', '--logout'], Gio.SubprocessFlags.NONE);
            this.menu.close();
        });
        this._tileBlur.register(this._logoutCircle.button);
        this._backgroundAdaptive.register(this._logoutCircle.button);
        this._circleRow.add_child(this._logoutCircle.button);

        this._displayCard = this._createSliderCard(
            'Display', 'display-brightness-symbolic', 'display-brightness-symbolic',
            percent => this._brightness.setPercent(percent));
        this._tileBlur.register(this._displayCard.actor);
        this._backgroundAdaptive.register(this._displayCard.actor);
        this._container.add_child(this._displayCard.actor);

        this._volumeCard = this._createSliderCard(
            'Volume', 'audio-volume-low-symbolic', 'audio-volume-high-symbolic',
            percent => this._volume.setPercent(percent));
        this._tileBlur.register(this._volumeCard.actor);
        this._backgroundAdaptive.register(this._volumeCard.actor);
        this._container.add_child(this._volumeCard.actor);

        this._utilityRow = new St.BoxLayout({style_class: 'macos-control-center-row', x_expand: true});
        this._container.add_child(this._utilityRow);

        this._calculatorGiconLight = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'calculator.png']));
        this._calculatorGiconDark = Gio.icon_new_for_string(GLib.build_filenamev(
            [this._extensionPath, 'icons', 'control-center', 'calculator-lowglass-dark.png']));
        this._calculatorCircle = this._createCircleButton(this._calculatorGiconLight, () => {
            Gio.Subprocess.new(['gnome-calculator'], Gio.SubprocessFlags.NONE);
        });
        this._tileBlur.register(this._calculatorCircle.button);
        this._backgroundAdaptive.register(this._calculatorCircle.button);
        this._utilityRow.add_child(this._calculatorCircle.button);

        this._timerGiconLight = Gio.icon_new_for_string(
            GLib.build_filenamev([this._extensionPath, 'icons', 'control-center', 'timer.png']));
        this._timerGiconDark = Gio.icon_new_for_string(GLib.build_filenamev(
            [this._extensionPath, 'icons', 'control-center', 'timer-lowglass-dark.png']));
        this._timerCircle = this._createCircleButton(this._timerGiconLight, () => this._openClocksPanel('timer'));
        this._tileBlur.register(this._timerCircle.button);
        this._backgroundAdaptive.register(this._timerCircle.button);
        this._utilityRow.add_child(this._timerCircle.button);

        this._pencilCircle = this._createCircleButton('document-edit-symbolic', () => {
            Gio.Subprocess.new(TEXT_EDITOR_NEW_WINDOW_CMD, Gio.SubprocessFlags.NONE);
        });
        this._tileBlur.register(this._pencilCircle.button);
        this._backgroundAdaptive.register(this._pencilCircle.button);
        this._utilityRow.add_child(this._pencilCircle.button);

        this._dndCircle = this._createCircleButton('notifications-symbolic', () => this._dnd.toggle());
        this._tileBlur.register(this._dndCircle.button);
        this._backgroundAdaptive.register(this._dndCircle.button);
        this._utilityRow.add_child(this._dndCircle.button);

        this.menu.addMenuItem(root);
    }

    _createPill(iconName, title, subtitle, onActivate) {
        const button = new St.Button({
            style_class: 'macos-control-center-pill',
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_expand: true,
        });
        button.set_pivot_point(0.5, 0.5);
        button.connect('clicked', () => this._animatePress(button, onActivate));

        // y_expand here too: the button (above) stretches to fill leftColumn's height
        // (matched to the media card next to it), and this row needs to stretch with it
        // so the badge/text -- already y_align: CENTER below -- actually center in the
        // taller pill instead of hugging its top edge with dead space under them.
        const content = new St.BoxLayout({style_class: 'macos-control-center-row', y_expand: true});
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
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textColumn.add_child(titleLabel);

        const subtitleLabel = new St.Label({text: subtitle, style_class: 'macos-control-center-pill-subtitle'});
        subtitleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
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
        const icon = new St.Icon({icon_name: iconName, icon_size: 10, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
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
        // Which of the 3 appearance-circle glyphs to show (light/dark-mode-shape, and
        // light-mode-shape-but-tinted-dark) is handled centrally by _applyIconTint(),
        // since it also depends on the Liquid Glass slider, not just this state -- this
        // just makes sure that runs whenever system dark/light mode changes too, not only
        // when the slider does.
        this._applyIconTint();

        if (state.dark)
            this._appearanceCircle.button.add_style_class_name('on');
        else
            this._appearanceCircle.button.remove_style_class_name('on');
    }

    /**
     * Real bug this fixes: the CSS-only Liquid Glass icon-darkening in controlCenterGlass.js
     * only ever affects symbolic icons (pencil/dnd/logout, loaded by icon_name) -- CSS
     * `color` has zero effect on a pre-baked PNG's own pixels, which is what
     * screenshot/appearance/airdrop/calculator/timer actually are. Those get swapped to a
     * separate pre-rendered dark-tinted PNG instead, at the exact same
     * DARK_CONTENT_THRESHOLD cutoff the CSS path uses, so nothing looks out of sync.
     */
    _applyIconTint() {
        const intensity = this._panelSettings.get_int('liquid-glass-intensity');
        const isDarkMode = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        const useDark = shouldUseDarkContent(intensity, isDarkMode);

        this._screenshotCircle.icon.gicon = useDark ? this._screenshotGiconDark : this._screenshotGiconLight;
        this._airdropCircle.icon.gicon = useDark ? this._airdropGiconDark : this._airdropGiconLight;
        this._calculatorCircle.icon.gicon = useDark ? this._calculatorGiconDark : this._calculatorGiconLight;
        this._timerCircle.icon.gicon = useDark ? this._timerGiconDark : this._timerGiconLight;

        // isDarkMode picks the *shape* (system dark mode has its own distinct glyph);
        // useDark only ever applies within the light-mode shape, tinting it instead of
        // swapping it -- see appearanceGiconLowglassDark's own comment where it's loaded.
        this._appearanceCircle.icon.gicon = isDarkMode
            ? this._appearanceGiconDark
            : (useDark ? this._appearanceGiconLowglassDark : this._appearanceGiconLight);
    }

    /**
     * Rough point behind where the popup will render, for BackgroundAdaptiveController's
     * pick_color() sample. Doesn't need to be exact -- it just needs to land somewhere
     * inside whatever window/desktop area the popup is about to cover, and in practice
     * that's a single window/wallpaper region regardless of exactly which tile it's under.
     * The menu's own actor isn't reliably laid out yet at the instant open-state-changed
     * fires true, so this is computed from the always-available panel button position
     * instead of the (not yet allocated) popup geometry.
     */
    _getBackgroundSamplePoint() {
        try {
            const [buttonX, buttonY] = this.get_transformed_position();
            const [, buttonHeight] = this.get_transformed_size();
            return {
                x: Math.max(0, Math.round(buttonX - CONTROL_CENTER_MENU_WIDTH / 2)),
                y: Math.round(buttonY + buttonHeight + 120),
            };
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to compute sample point');
            return null;
        }
    }

    /**
     * gnome-clocks has no D-Bus action to jump to a specific tab, but it
     * restores whatever view was active via this GSettings key on launch --
     * set it first so a fresh window (or one raised from the background
     * gapplication service) opens straight on the requested tab.
     * @param {'world'|'alarm'|'stopwatch'|'timer'} panelId
     */
    _openClocksPanel(panelId) {
        try {
            const clocksState = new Gio.Settings({schema_id: CLOCKS_STATE_SCHEMA_ID});
            clocksState.set_string('panel-id', panelId);
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to set clocks panel-id');
        }
        Gio.Subprocess.new(['gnome-clocks'], Gio.SubprocessFlags.NONE);
    }

    _updateDnd(state) {
        this._dndCircle.icon.icon_name = state.dnd ? 'weather-clear-night-symbolic' : 'notifications-symbolic';
        if (state.dnd)
            this._dndCircle.button.add_style_class_name('on');
        else
            this._dndCircle.button.remove_style_class_name('on');
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
                this._mediaCard.artIcon.icon_size = 18;
            }
        } catch (e) {
            logError(e, '[macos-top-panel] control center: failed to update media card');
        }
    }
});
