import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AppPinnerExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.app-pinner');
        
        // Pagina principale - Applicazioni Pinnate
        const mainPage = new Adw.PreferencesPage({
            title: 'Applications',
            icon_name: 'applications-other-symbolic'
        });
        this._buildAppsPage(mainPage, settings);
        window.add(mainPage);

        // Pagina Aspetto
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic'
        });
        this._buildAppearancePage(appearancePage, settings);
        window.add(appearancePage);

        // Pagina Avanzate
        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'dialog-password-symbolic'
        });
        this._buildAdvancedPage(advancedPage, settings);
        window.add(advancedPage);

        const clickController = new Gtk.GestureClick();
        clickController.set_propagation_phase(Gtk.PropagationPhase.TARGET);
        
        clickController.connect('pressed', (ctrl, n_press, x, y) => {
            const currentFocus = window.get_focus();
            
            if (currentFocus instanceof Gtk.Entry) {
                const alloc = currentFocus.get_allocation();
                const [success, entryX, entryY] = currentFocus.translate_coordinates(window, 0, 0);
                
                if (success) {
                    const entryRight = entryX + alloc.get_width();
                    const entryBottom = entryY + alloc.get_height();
                    
                    if (x < entryX || x > entryRight || y < entryY || y > entryBottom) {
                        window.set_focus(null);
                    }
                }
            }
        });

        window.add_controller(clickController);

        // Pagina Scorciatoie
        const shortcutsPage = new Adw.PreferencesPage({
            title: 'Shortcuts',
            icon_name: 'preferences-desktop-keyboard-symbolic'
        });
        this._buildShortcutsPage(shortcutsPage, settings);
        window.add(shortcutsPage);
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
        } catch(e) {
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

    _buildAppsPage(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Pinned Applications',
            description: 'Manage applications in quick launch'
        });

        // Lista applicazioni
        const listStore = new Gtk.StringList();
        const refreshList = () => listStore.splice(0, listStore.get_n_items(), settings.get_strv('pinned-apps'));
        refreshList();

        // Factory per la lista
        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_, listItem) => {
            listItem.set_child(new Gtk.Label({ xalign: 0, margin_start: 8 }));
        });
        factory.connect('bind', (_, listItem) => {
            listItem.get_child().label = listItem.get_item().string;
        });

        // ListView
        const listView = new Gtk.ListView({
            model: new Gtk.SingleSelection({ model: listStore }),
            factory: factory
        });

        // Pulsanti
        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.END
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: 'Add Application'
        });

        const removeButton = new Gtk.Button({
            icon_name: 'list-remove-symbolic',
            tooltip_text: 'Remove Selected',
            sensitive: false
        });

        // Logica pulsanti
        addButton.connect('clicked', async () => {
            const dialog = new Gtk.FileDialog();
            dialog.set_filters([new Gtk.FileFilter({ name: 'Desktop Files', patterns: ['*.desktop']} )]);
            
            try {
                const file = await dialog.open(null);
                const appId = file.get_basename().replace('.desktop', '');
                const apps = settings.get_strv('pinned-apps');
                
                if (!apps.includes(appId)) {
                    settings.set_strv('pinned-apps', [...apps, appId]);
                    refreshList();
                }
            } catch (error) {
                console.log('Selection cancelled:', error.message);
            }
        });

        listView.get_model().connect('selection-changed', () => {
            removeButton.sensitive = listView.get_model().get_selected() !== Gtk.INVALID_LIST_POSITION;
        });

        removeButton.connect('clicked', () => {
            const pos = listView.get_model().get_selected();
            if (pos !== Gtk.INVALID_LIST_POSITION) {
                const apps = settings.get_strv('pinned-apps');
                apps.splice(pos, 1);
                settings.set_strv('pinned-apps', apps);
                refreshList();
            }
        });

        buttonBox.append(addButton);
        buttonBox.append(removeButton);

        group.add(new Gtk.ScrolledWindow({
            height_request: 200,
            child: listView
        }));
        group.set_header_suffix(buttonBox);
        page.add(group);
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
}