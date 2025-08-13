import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AppPinnerExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.app-pinner');

        window.set_search_enabled(true);

        // Pagina Aspetto
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic'
        });
        this._buildAppearancePage(appearancePage, settings);
        window.add(appearancePage);

        // Pagina Scorciatoie
        const shortcutsPage = new Adw.PreferencesPage({
            title: 'Shortcuts',
            icon_name: 'preferences-desktop-keyboard-symbolic'
        });
        this._buildShortcutsPage(shortcutsPage, settings);
        window.add(shortcutsPage);

        // Pagina Avvio Automatico
        const startupPage = new Adw.PreferencesPage({
            title: 'Startup Apps',
            icon_name: 'system-run-symbolic'
        });
        this._buildStartupPage(startupPage, settings);
        window.add(startupPage);

        // Pagina About
        const aboutPage = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'dialog-information-symbolic'
        });
        this._buildAboutPage(aboutPage);
        window.add(aboutPage);
    }

    _buildAppearancePage(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Panel Customization',
            description: 'Adjust how pinned apps appear in your top panel'
        });

        const iconSizeRow = new Adw.SpinRow({
            title: 'Icon Size',
            subtitle: 'Recommended between 16-24 pixels for optimal panel integration',
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('icon-size'),
                lower: 16,
                upper: 24,
                step_increment: 1
            })
        });
        settings.bind('icon-size', iconSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(iconSizeRow);

        const positionRow = new Adw.ComboRow({
            title: 'Panel Position',
            subtitle: 'Choose where to show the pinned apps in your top panel',
            model: new Gtk.StringList({ strings: ['left', 'center', 'right'] })
        });

        positionRow.connect('notify::selected', () => {
            const selectedString = positionRow.model.get_string(positionRow.selected);
            settings.set_string('position-in-panel', selectedString);
        });

        const currentPos = settings.get_string('position-in-panel');
        positionRow.selected = ['left', 'center', 'right'].indexOf(currentPos);

        group.add(positionRow);

        const spacingRow = new Adw.SpinRow({
            title: 'Icon Spacing',
            subtitle: 'Space between app icons in pixels',
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('spacing'),
                lower: 0,
                upper: 20,
                step_increment: 1
            })
        });
        settings.bind('spacing', spacingRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(spacingRow);

        const colorRow = new Adw.ActionRow({
            title: 'Indicator Color',
            subtitle: 'Choose color for running apps indicator'
        });

        const colorButton = new Gtk.ColorButton({
            valign: Gtk.Align.CENTER,
            use_alpha: true
        });

        const initialColor = new Gdk.RGBA();
        initialColor.parse(settings.get_string('indicator-color'));
        colorButton.set_rgba(initialColor);

        colorButton.connect('color-set', (btn) => {
            const color = btn.get_rgba().to_string();
            settings.set_string('indicator-color', color);
        });

        colorRow.add_suffix(colorButton);
        colorRow.set_activatable_widget(colorButton);
        group.add(colorRow);

        const sortToggle = new Adw.SwitchRow({
            title: 'Sort Alphabetically',
            subtitle: 'Automatically sort apps by name',
            active: settings.get_boolean('sort-alphabetically')
        });
        settings.bind('sort-alphabetically', sortToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(sortToggle);

        const visibilityGroup = new Adw.PreferencesGroup({
            title: 'Visibility Options',
            description: 'Control what elements are displayed in the panel'
        });

        const panelToggle = new Adw.SwitchRow({
            title: 'Show in Top Panel',
            subtitle: 'Display pinned apps directly in the panel',
            active: settings.get_boolean('show-in-panel')
        });
        settings.bind('show-in-panel', panelToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(panelToggle);

        const pinIconToggle = new Adw.SwitchRow({
            title: 'Show Pin Icon',
            subtitle: 'Display the pin icon when apps are pinned',
            active: settings.get_boolean('show-pin-icon')
        });
        settings.bind('show-pin-icon', pinIconToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        visibilityGroup.add(pinIconToggle);

        page.add(visibilityGroup);

        page.add(group);
    }

    _buildShortcutsPage(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcuts',
            description: 'Assign custom keyboard shortcuts to launch your pinned apps directly.\nShortcuts are position-based and will follow your current app order.'
        });

        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['shortcut-list']
        });

        const updateList = () => {
            let child = listBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                listBox.remove(child);
                child = next;
            }

            const pinnedApps = settings.get_strv('pinned-apps');
            if (pinnedApps.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: 'No Pinned Apps',
                    subtitle: 'Pin apps from the main menu to enable shortcuts',
                    css_classes: ['dim-label']
                });
                listBox.append(emptyRow);
                return;
            }

            pinnedApps.forEach((appId, index) => {
                const position = index + 1;
                const appName = this._getAppName(appId) || 'Unknown Application';

                const row = new Adw.ActionRow({
                    title: `Position ${position}`,
                    subtitle: appName,
                    css_classes: ['shortcut-row']
                });

                const entry = new Gtk.Entry({
                    text: this._acceleratorToLabel(settings.get_string(`shortcut-${position}`)),
                    editable: false,
                    width_chars: 20,
                    css_classes: ['shortcut-entry'],
                    placeholder_text: 'Click to set shortcut',
                    tooltip_text: `Press any key combination for ${appName}`
                });

                entry.connect('notify::has-focus', (widget) => {
                    if (!widget.hasFocus) {
                        widget.set_selection(0, 0);
                        widget.set_position(-1);
                    }
                });

                const controller = new Gtk.EventControllerKey();
                controller.connect('key-pressed', (_, keyval, _keycode, state) => {
                    if (keyval === Gdk.KEY_Escape) {
                        entry.grab_focus_away();
                        return Gdk.EVENT_STOP;
                    }

                    const isModifier = [
                        Gdk.KEY_Control_L, Gdk.KEY_Control_R,
                        Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
                        Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
                        Gdk.KEY_Super_L, Gdk.KEY_Super_R
                    ].includes(keyval);

                    if (isModifier) return Gdk.EVENT_STOP;

                    const modifiers = state & Gtk.accelerator_get_default_mod_mask();
                    const accelerator = Gtk.accelerator_name(keyval, modifiers);

                    entry.text = this._acceleratorToLabel(accelerator);
                    settings.set_string(`shortcut-${position}`, accelerator);
                    return Gdk.EVENT_STOP;
                });

                entry.add_controller(controller);

                const clearButton = new Gtk.Button({
                    icon_name: 'edit-clear-symbolic',
                    tooltip_text: 'Clear shortcut'
                });

                clearButton.connect('clicked', () => {
                    entry.text = 'Disabled';
                    settings.set_string(`shortcut-${position}`, '');
                });

                row.add_suffix(entry);
                row.add_suffix(clearButton);
                listBox.append(row);
            });
        };

        updateList();

        settings.connect('changed::pinned-apps', () => {
            updateList();
        });

        const scrolledWindow = new Gtk.ScrolledWindow({
            height_request: 300,
            child: listBox
        });

        group.add(scrolledWindow);
        page.add(group);
    }

    _buildStartupPage(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Launch at Startup',
            description: 'Select applications to launch automatically when you log in'
        });

        const listStore = new Gtk.StringList();
        const updateList = () => {
            const pinned = settings.get_strv('pinned-apps');
            listStore.splice(0, listStore.get_n_items(), pinned);
        };

        updateList();
        settings.connect('changed::pinned-apps', updateList);

        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_, listItem) => {
            const row = new Adw.ActionRow();
            const icon = new Gtk.Image({ icon_size: Gtk.IconSize.LARGE, margin_end: 12 });
            row.add_prefix(icon);

            const toggle = new Gtk.Switch({
                valign: Gtk.Align.CENTER,
                halign: Gtk.Align.END
            });
            row.add_suffix(toggle);

            row._icon = icon;
            row._toggle = toggle;
            listItem.set_child(row);
        });

        factory.connect('bind', (_, listItem) => {
            const appId = listItem.get_item().string;
            const row = listItem.get_child();
            const toggle = row._toggle;

            const startupApps = settings.get_strv('startup-apps');
            toggle.set_active(startupApps.includes(appId));

            toggle.connect('notify::active', (sw) => {
                const newStartup = sw.active
                    ? [...settings.get_strv('startup-apps'), appId]
                    : settings.get_strv('startup-apps').filter(id => id !== appId);
                settings.set_strv('startup-apps', newStartup);
            });

            const appInfo = this._getAppInfo(appId);
            row.set_title(appInfo?.get_name() || appId);
            row._icon.set_from_gicon(appInfo?.get_icon());
        });

        const listView = new Gtk.ListView({
            model: new Gtk.SingleSelection({ model: listStore }),
            factory: factory
        });

        const scrolledWindow = new Gtk.ScrolledWindow({
            height_request: 300,
            child: listView
        });
        group.add(scrolledWindow);
        page.add(group);
    }

    _buildAboutPage(page) {
        const group = new Adw.PreferencesGroup({
            title: this.metadata.name,
            description: 'A modern application pinner and quick launcher for GNOME Shell'
        });

        const versionRow = new Adw.ActionRow({
            title: 'Version'
        });
        const versionLabel = new Gtk.Label({
            label: `v${this.metadata.version.toString()}`,
            css_classes: ['dim-label'],
            xalign: 0
        });
        versionRow.add_suffix(versionLabel);
        group.add(versionRow);

        const authorRow = new Adw.ActionRow({
            title: 'Developer'
        });

        const githubButton = new Gtk.Button({
            label: this.metadata.creator,
            css_classes: ['flat', 'suggested-action'],
            tooltip_text: 'Open GitHub profile',
            margin_top: 6,
            margin_bottom: 6
        });

        githubButton.connect('clicked', () => {
            Gio.AppInfo.launch_default_for_uri('https://github.com/comitanigiacomo', null);
        });

        authorRow.add_suffix(githubButton);
        authorRow.activatable_widget = githubButton;
        group.add(authorRow);

        const repoRow = new Adw.ActionRow({
            title: 'Repository'
        });

        const repoButton = new Gtk.Button({
            label: 'Source Code',
            css_classes: ['flat', 'suggested-action'],
            tooltip_text: 'Open GitHub repository',
            margin_top: 6,
            margin_bottom: 6
        });

        repoButton.connect('clicked', () => {
            if (this.metadata.url) {
                Gio.AppInfo.launch_default_for_uri(this.metadata.url, null);
            }
        });

        repoRow.add_suffix(repoButton);
        repoRow.activatable_widget = repoButton;
        group.add(repoRow);

        const licenseRow = new Adw.ActionRow({
            title: 'License'
        });

        const licenseButton = new Gtk.Button({
            label: 'GPLv3',
            css_classes: ['flat', 'suggested-action'],
            tooltip_text: 'View license details',
            margin_top: 6,
            margin_bottom: 6
        });

        licenseButton.connect('clicked', () => {
            Gio.AppInfo.launch_default_for_uri('https://github.com/comitanigiacomo/quicklaunch?tab=GPL-3.0-1-ov-file', null);
        });

        licenseRow.add_suffix(licenseButton);
        licenseRow.activatable_widget = licenseButton;
        group.add(licenseRow);

        const descriptionLabel = new Gtk.Label({
            label: `
                
        ● 🚀  One-Click Access: Launch apps/links directly from panel\n
        ● ⌨️  Custom Shortcuts: Configurable keyboard combinations\n
        ● 🔴  Live Indicators: Real-time running app status\n
        ● 🌐  Web Links: Open URLs in default browser\n
        ● ⚡  Auto-Start: Launch critical apps at login\n
        ● 🔧  Smart Reordering: long-press to organize\n
        ● 🔍  Instant Search: Find/pin apps from dropdown\n\n
        Optimized for power users - Seamless GNOME integration
            `
                .replace(/ {8}/g, '')
                .trim(),
            wrap: true,
            xalign: 0.5,
            halign: Gtk.Align.CENTER,
            hexpand: true
        });

        const descGroup = new Adw.PreferencesGroup();
        descGroup.add(descriptionLabel);

        page.add(group);
        page.add(descGroup);
    }

    _acceleratorToLabel(accel) {
        if (!accel) return 'Disabled';

        try {
            const [success, keyval, mods] = Gtk.accelerator_parse(accel);
            return success ? Gtk.accelerator_get_label(keyval, mods) : 'Invalid';
        } catch (e) {
            return 'Error';
        }
    }

    _labelToAccelerator(label) {
        let [success, keyval, mods] = Gtk.accelerator_parse(label);

        if (!success || keyval === 0) {
            const custom = this._parseCustomShortcut(label);
            [success, keyval, mods] = Gtk.accelerator_parse(custom);
        }

        if (success && keyval !== 0) {
            return Gtk.accelerator_name(keyval, mods);
        }
        return '';
    }

    _configureShortcut(window, settings, key, entry) {

        const dialog = new Gtk.Dialog({
            title: 'Set Shortcut',
            transient_for: window,
            modal: true,
            use_header_bar: true
        });

        let accelerator = settings.get_string(key);
        const label = new Gtk.Label({
            label: 'Press desired key combination...\nCurrent: ' + this._acceleratorToLabel(accelerator),
            margin: 12
        });

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_, keyval, _keycode, state) => {
            try {
                const mask = state & Gtk.accelerator_get_default_mod_mask();

                const validMods = mask & (
                    Gdk.ModifierType.SHIFT_MASK |
                    Gdk.ModifierType.CONTROL_MASK |
                    Gdk.ModifierType.ALT_MASK |
                    Gdk.ModifierType.SUPER_MASK
                );

                if (keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R ||
                    keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
                    keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
                    keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R) {
                    return Gdk.EVENT_STOP;
                }

                accelerator = Gtk.accelerator_name(keyval, validMods);
                label.label = 'New shortcut: ' + this._acceleratorToLabel(accelerator);

                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    dialog.queue_draw();
                    return GLib.SOURCE_REMOVE;
                });

            } catch (e) {
                console.error('Error processing key:', e);
            }
            return Gdk.EVENT_STOP;
        });

        dialog.add_controller(controller);

        const resetButton = new Gtk.Button({
            label: 'Reset',
            margin_end: 12
        });
        resetButton.connect('clicked', () => {
            accelerator = '';
            label.label = 'Shortcut cleared!';
        });

        dialog.get_content_area().append(label);
        dialog.get_header_bar().pack_end(resetButton);

        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Save', Gtk.ResponseType.OK);

        dialog.connect('response', (_, response) => {
            if (response === Gtk.ResponseType.OK) {
                try {
                    const [success] = Gtk.accelerator_parse(accelerator);
                    if (success) {
                        settings.set_string(key, accelerator);
                        entry.text = this._acceleratorToLabel(accelerator);
                    } else {
                        this._showErrorDialog('Invalid shortcut combination');
                    }
                } catch (e) {
                    this._showErrorDialog(`Error saving shortcut: ${e.message}`);
                }
            }
            dialog.destroy();
        });

        dialog.present();
    }

    _showErrorDialog(message) {
        const dialog = new Gtk.MessageDialog({
            transient_for: this._window,
            modal: true,
            message_type: Gtk.MessageType.ERROR,
            buttons: Gtk.ButtonsType.OK,
            text: message
        });
        dialog.connect('response', () => dialog.destroy());
        dialog.present();
    }

    _parseCustomShortcut(text) {
        try {
            const normalized = text
                .replace(/</g, '')
                .replace(/>/g, '+')
                .toLowerCase();

            const parts = normalized.split('+');
            let mods = 0;
            let keyval = 0;

            parts.forEach(part => {
                const mod = Gtk.accelerator_parse_modifier(part.trim());
                if (mod) {
                    mods |= mod;
                } else {
                    keyval = Gtk.accelerator_parse_key(part.trim(), 0);
                }
            });

            return Gtk.accelerator_name(keyval, mods);
        } catch (e) {
            return '';
        }
    }

    _validateAccelerator(accel) {
        try {
            const [success, keyval] = Gtk.accelerator_parse(accel);
            return success && keyval !== 0;
        } catch (e) {
            return false;
        }
    }

    _getAppInfo(appId) {
        const variants = [
            appId,
            `${appId}.desktop`,
            `${appId.replace(/-/g, '')}.desktop`,
            appId.toLowerCase(),
            `${appId.toLowerCase()}.desktop`
        ];

        const searchPaths = [
            GLib.get_user_data_dir() + '/applications',
            '/usr/share/applications',
            '/usr/local/share/applications'
        ];

        for (const variant of variants) {
            const appInfo = Gio.DesktopAppInfo.new(variant);
            if (appInfo) return appInfo;

            for (const path of searchPaths) {
                const fullPath = `${path}/${variant}`;
                if (GLib.file_test(fullPath, GLib.FileTest.EXISTS)) {
                    return Gio.DesktopAppInfo.new_from_filename(fullPath);
                }
            }
        }
        return null;
    }

    _getAppDisplayInfo(appId) {
        let appInfo = Gio.DesktopAppInfo.new(`${appId}.desktop`);

        if (!appInfo) {
            const cleanId = appId.replace(/^application:\/\//, '');
            appInfo = Gio.DesktopAppInfo.new(`${cleanId}.desktop`);
        }

        if (!appInfo) {
            const shellApp = Shell.AppSystem.get_default().lookup_app(appId);
            if (shellApp) {
                return {
                    name: shellApp.get_name(),
                    icon: shellApp.get_icon()
                };
            }
        }

        if (!appInfo) {
            const variations = [
                appId.toLowerCase(),
                appId.replace(/-/g, ''),
                `${appId}.desktop`,
                `${appId.toLowerCase()}.desktop`
            ];

            for (const variant of variations) {
                appInfo = Gio.DesktopAppInfo.new(variant);
                if (appInfo) break;
            }
        }

        return {
            name: appInfo ? appInfo.get_name() : appId,
            icon: appInfo ? appInfo.get_icon() : null
        };
    }

    _getAppName(appId) {
        const appInfo = Gio.DesktopAppInfo.new(`${appId}.desktop`);
        return appInfo ? appInfo.get_name() : appId;
    }

    _sanitizeAppId(appId) {
        return appId
            .replace(/^application:\/\//, '')
            .replace(/\.desktop$/i, '')
            .replace(/\s+/g, '-')
            .toLowerCase();
    }
}