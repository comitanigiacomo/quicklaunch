import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
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
            model: new Gtk.StringList({ strings: ['left', 'right'] })
        });

        const currentPos = settings.get_string('position-in-panel');
        positionRow.selected = currentPos === 'left' ? 0 : 1;

        positionRow.connect('notify::selected', () => {
            const selectedString = positionRow.model.get_string(positionRow.selected);
            settings.set_string('position-in-panel', selectedString);
        });

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