import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AppPinnerExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.app-pinner');

        // Imposta la navigazione a sidebar (nativa di Adwaita)
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


        // Pagina Avanzate
        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'dialog-password-symbolic'
        });
        this._buildAdvancedPage(advancedPage, settings);
        window.add(advancedPage);


        // Pagina Avvio Automatico
        const startupPage = new Adw.PreferencesPage({
            title: 'Startup Apps',
            icon_name: 'system-run-symbolic'
        });
        this._buildStartupPage(startupPage, settings);
        window.add(startupPage);
    }

    _buildShortcutsPage(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcuts',
            description: 'Click on a field and press the desired key combination'
        });

        for (let i = 1; i <= 10; i++) {
            const row = new Adw.ActionRow({
                title: `Position ${i}`,
            });

            const entry = new Gtk.Entry({
                text: this._acceleratorToLabel(settings.get_string(`shortcut-${i}`)),
                editable: false,
                width_chars: 20,
                css_classes: ['shortcut-entry']
            });

            // SOSTITUIAMO focus-out-event con notify::has-focus
            entry.connect('notify::has-focus', (widget) => {
                if (!widget.hasFocus) {
                    widget.set_selection(0, 0);
                    widget.set_position(-1);
                }
            });

            // Aggiungiamo un controller per gli eventi della tastiera
            const controller = new Gtk.EventControllerKey();
            let modifiers = 0;

            controller.connect('key-pressed', (_, keyval, _keycode, state) => {

                if (keyval === Gdk.KEY_Escape) {
                    entry.grab_focus_away();
                    return Gdk.EVENT_STOP;
                }
                // Ignora i tasti modificatori da soli
                const isModifier = [
                    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
                    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
                    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
                    Gdk.KEY_Super_L, Gdk.KEY_Super_R
                ].includes(keyval);

                if (isModifier) return Gdk.EVENT_STOP;

                // Calcola i modificatori attivi
                modifiers = state & Gtk.accelerator_get_default_mod_mask();

                // Converti in acceleratore
                const accelerator = Gtk.accelerator_name(keyval, modifiers);

                // Aggiorna l'UI e le impostazioni
                entry.text = this._acceleratorToLabel(accelerator);
                settings.set_string(`shortcut-${i}`, accelerator);

                return Gdk.EVENT_STOP;
            });

            entry.add_controller(controller);

            // Pulsante per cancellare la scorciatoia
            const clearButton = new Gtk.Button({
                icon_name: 'edit-clear-symbolic',
                tooltip_text: 'Clear shortcut'
            });

            clearButton.connect('clicked', () => {
                entry.text = 'Disabled';
                settings.set_string(`shortcut-${i}`, '');
            });

            row.add_suffix(entry);
            row.add_suffix(clearButton);
            group.add(row);
        }

        page.add(group);
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
        // Prima prova il parsing standard
        let [success, keyval, mods] = Gtk.accelerator_parse(label);

        // Se fallisce, prova il parsing custom
        if (!success || keyval === 0) {
            const custom = this._parseCustomShortcut(label);
            [success, keyval, mods] = Gtk.accelerator_parse(custom);
        }

        if (success && keyval !== 0) {
            return Gtk.accelerator_name(keyval, mods);
        }
        return '';
    }

    _validateAccelerator(accel) {
        try {
            const [success, keyval] = Gtk.accelerator_parse(accel);
            return success && keyval !== 0;
        } catch (e) {
            return false;
        }
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

                // Filtra i modificatori non supportati e i tasti non validi
                const validMods = mask & (
                    Gdk.ModifierType.SHIFT_MASK |
                    Gdk.ModifierType.CONTROL_MASK |
                    Gdk.ModifierType.ALT_MASK |
                    Gdk.ModifierType.SUPER_MASK
                );

                // Ignora i tasti modificatori da soli
                if (keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R ||
                    keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
                    keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
                    keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R) {
                    return Gdk.EVENT_STOP;
                }

                accelerator = Gtk.accelerator_name(keyval, validMods);
                label.label = 'New shortcut: ' + this._acceleratorToLabel(accelerator);

                // Forza l'aggiornamento immediato
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    dialog.queue_draw();
                    return GLib.SOURCE_REMOVE;
                });

            } catch (e) {
                console.error('Error processing key:', e);
            }
            return Gdk.EVENT_STOP;
        });

        // Aggiungi controller alla finestra
        dialog.add_controller(controller);

        // Pulsante reset
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
                    // Validazione finale
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
            // Supporta sia formato "Alt+1" che "<Alt>1"
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

    _validateAccelerator(accelerator) {
        try {
            const [success] = Gtk.accelerator_parse(accelerator);
            return success;
        } catch (e) {
            return false;
        }
    }

    _getAppInfo(appId) {
        // Try different naming variations
        const variants = [
            appId,
            `${appId}.desktop`,
            `${appId.replace(/-/g, '')}.desktop`,  // Per app IDs con trattini
            appId.toLowerCase(),
            `${appId.toLowerCase()}.desktop`
        ];

        // Check both user and system applications
        const searchPaths = [
            GLib.get_user_data_dir() + '/applications',
            '/usr/share/applications',
            '/usr/local/share/applications'
        ];

        for (const variant of variants) {
            const appInfo = Gio.DesktopAppInfo.new(variant);
            if (appInfo) return appInfo;

            // Cerca nei path delle applicazioni
            for (const path of searchPaths) {
                const fullPath = `${path}/${variant}`;
                if (GLib.file_test(fullPath, GLib.FileTest.EXISTS)) {
                    return Gio.DesktopAppInfo.new_from_filename(fullPath);
                }
            }
        }
        return null;
    }

    _sanitizeAppId(appId) {
        return appId.replace(/\.desktop$/, '')
            .replace(/^application:\/+/g, '');
    }

    _buildAppearancePage(page, settings) {
        const group = new Adw.PreferencesGroup();

        // Dimensioni icone 1-9 (16-24px)
        const iconSizeRow = new Adw.SpinRow({
            title: 'Icon Size (px)',
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('icon-size'),
                lower: 16,
                upper: 24,
                step_increment: 1
            })
        });
        settings.bind('icon-size', iconSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(iconSizeRow);

        // Posizione
        const positionRow = new Adw.ComboRow({
            title: 'Panel Position',
            model: new Gtk.StringList({ strings: ['left', 'center', 'right'] })
        });

        positionRow.connect('notify::selected', () => {
            const selectedString = positionRow.model.get_string(positionRow.selected);
            settings.set_string('position-in-panel', selectedString);
        });

        const currentPos = settings.get_string('position-in-panel');
        positionRow.selected = ['left', 'center', 'right'].indexOf(currentPos);

        group.add(positionRow);

        // Spaziatura
        const spacingRow = new Adw.SpinRow({
            title: 'Spacing Between Icons',
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('spacing'),
                lower: 0,
                upper: 10,
                step_increment: 1
            })
        });
        settings.bind('spacing', spacingRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(spacingRow);

        // Etichette
        const labelsRow = new Adw.SwitchRow({
            title: 'Show Application Labels'
        });
        settings.bind('enable-labels', labelsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(labelsRow);

        // Sostituisci Adw.ColorRow con Gtk.ColorButton
        const colorRow = new Adw.ActionRow({
            title: 'Indicator Color',
            subtitle: 'Choose color for running apps indicator'
        });

        const colorButton = new Gtk.ColorButton({
            valign: Gtk.Align.CENTER,
            use_alpha: true
        });

        // Converti il valore stringa in Gdk.RGBA
        const initialColor = new Gdk.RGBA();
        initialColor.parse(settings.get_string('indicator-color'));
        colorButton.set_rgba(initialColor);

        // Aggiorna le impostazioni quando cambia il colore
        colorButton.connect('color-set', (btn) => {
            const color = btn.get_rgba().to_string();
            settings.set_string('indicator-color', color);
        });

        colorRow.add_suffix(colorButton);
        colorRow.set_activatable_widget(colorButton);
        group.add(colorRow);

        page.add(group);
    }

    _buildAdvancedPage(page, settings) {
        const group = new Adw.PreferencesGroup();

        // Numero massimo app
        const maxAppsRow = new Adw.SpinRow({
            title: 'Maximum Applications',
            adjustment: new Gtk.Adjustment({
                value: settings.get_int('max-apps'),
                lower: 1,
                upper: 20,
                step_increment: 1
            })
        });
        settings.bind('max-apps', maxAppsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(maxAppsRow);

        // App predefinite
        const defaultAppsRow = new Adw.EntryRow({
            title: 'Default Apps',
            text: settings.get_strv('default-apps').join(', ')
        });
        settings.bind('default-apps', defaultAppsRow, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(defaultAppsRow);

        // Animazioni
        const animationRow = new Adw.SwitchRow({
            title: 'Enable Launch Animation'
        });
        settings.bind('launch-animation', animationRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(animationRow);

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

            // Salva riferimenti per il binding
            row._icon = icon;
            row._toggle = toggle;
            listItem.set_child(row);
        });

        factory.connect('bind', (_, listItem) => {
            const appId = listItem.get_item().string;
            const row = listItem.get_child();
            const toggle = row._toggle;

            // Aggiorna lo stato dell'interruttore
            const startupApps = settings.get_strv('startup-apps');
            const isActive = startupApps.includes(appId);
            toggle.set_active(isActive);

            // Connetti il segnale dopo aver impostato lo stato iniziale
            toggle.connect('notify::active', (sw) => {
                const newActive = sw.active;

                const currentStartup = settings.get_strv('startup-apps');

                const newStartupApps = newActive
                    ? [...currentStartup, appId]
                    : currentStartup.filter(id => id !== appId);

                settings.set_strv('startup-apps', newStartupApps);

                // Verifica immediata dello stato salvato
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    const verify = settings.get_strv('startup-apps');
                    return GLib.SOURCE_REMOVE;
                });
            });

            // Aggiorna icona e nome
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

        // Aggiungi listener per cambiamenti nelle impostazioni
        settings.connect('changed::startup-apps', () => {
            console.log('[STARTUP] Impostazioni startup-apps cambiate:', settings.get_strv('startup-apps'));
        });
    }

    _getAppDisplayInfo(appId) {
        // Tentativo 1: Cerca direttamente
        let appInfo = Gio.DesktopAppInfo.new(`${appId}.desktop`);

        // Tentativo 2: Rimuovi eventuali URL schemes
        if (!appInfo) {
            const cleanId = appId.replace(/^application:\/\//, '');
            appInfo = Gio.DesktopAppInfo.new(`${cleanId}.desktop`);
        }

        // Tentativo 3: Cerca tramite AppSystem
        if (!appInfo) {
            const shellApp = Shell.AppSystem.get_default().lookup_app(appId);
            if (shellApp) {
                return {
                    name: shellApp.get_name(),
                    icon: shellApp.get_icon()
                };
            }
        }

        // Tentativo 4: Cerca in altri formati
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