import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';

export default class AppPinnerPrefs extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super({
            title: 'Quick Launch Settings',
            icon_name: 'pan-start-symbolic'
        });

        this.settings = settings;
        this._buildUI();
    }

    _buildUI() {
        // Rimuovi il contenuto esistente
        const existingChild = this.get_child();
        if (existingChild) this.remove(existingChild);

        // Main container
        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
            spacing: 12
        });

        // Lista applicazioni
        this.listStore = new Gtk.StringList();
        this._refreshList();

        // ListView
        const selectionModel = new Gtk.SingleSelection({ model: this.listStore });
        this.listView = new Gtk.ListView({
            model: selectionModel,
            show_separators: true,
            factory: new Gtk.SignalListItemFactory({
                setup: (_, listItem) => {
                    listItem.set_child(new Gtk.Label({
                        xalign: 0,
                        margin_start: 8
                    }));
                },
                bind: (_, listItem) => {
                    const label = listItem.get_child();
                    const item = listItem.get_item();
                    label.label = item.string;
                }
            })
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

        // Aggiorna stato pulsante rimozione
        selectionModel.connect('selection-changed', () => {
            removeButton.sensitive = selectionModel.get_selected() !== Gtk.INVALID_LIST_POSITION;
        });

        buttonBox.append(addButton);
        buttonBox.append(removeButton);

        // Assemblaggio
        const scrolledWindow = new Gtk.ScrolledWindow({
            height_request: 200,
            child: this.listView
        });

        mainBox.append(scrolledWindow);
        mainBox.append(buttonBox);
        this.set_child(mainBox);

        // Connessioni pulsanti
        addButton.connect('clicked', () => this._onAddApp());
        removeButton.connect('clicked', () => this._onRemoveApp(selectionModel));
    }

    _refreshList() {
        this.listStore.splice(0, this.listStore.get_n_items(), 
            this.settings.get_strv('pinned-apps'));
    }

    async _onAddApp() {
        const fileDialog = new Gtk.FileDialog();
        fileDialog.title = 'Select Application';
        fileDialog.modal = true;

        // Filtro per file .desktop
        const filter = new Gtk.FileFilter();
        filter.add_pattern('*.desktop');
        fileDialog.set_filters([filter]);

        try {
            const file = await fileDialog.open(this.get_root());
            const path = file.get_path();
            const appId = path.split('/').pop().replace('.desktop', '');
            
            const apps = this.settings.get_strv('pinned-apps');
            if (!apps.includes(appId)) {
                apps.push(appId);
                this.settings.set_strv('pinned-apps', apps);
                this._refreshList();
            }
        } catch (error) {
            logError(error, 'Error selecting application');
        }
    }

    _onRemoveApp(selectionModel) {
        const position = selectionModel.get_selected();
        if (position !== Gtk.INVALID_LIST_POSITION) {
            const apps = this.settings.get_strv('pinned-apps');
            apps.splice(position, 1);
            this.settings.set_strv('pinned-apps', apps);
            this._refreshList();
        }
    }
}