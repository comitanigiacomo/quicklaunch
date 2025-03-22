import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';

const AppPinnerPrefs = GObject.registerClass(
class AppPinnerPrefs extends Adw.PreferencesPage {
    _init(settings) {
        super._init();
        this.settings = settings;
        this._buildUI();
    }

    _buildUI() {
        let box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10 });

        let store = new Gtk.ListStore();
        store.set_column_types([GObject.TYPE_STRING]);

        let treeView = new Gtk.TreeView({ model: store });
        let renderer = new Gtk.CellRendererText();
        let column = new Gtk.TreeViewColumn({ title: 'Application', renderer, text: 0 });

        treeView.append_column(column);
        box.append(treeView);

        let buttonBox = new Gtk.Box({ spacing: 10 });
        let addButton = new Gtk.Button({ label: 'Add App' });
        let removeButton = new Gtk.Button({ label: 'Remove Selected' });

        buttonBox.append(addButton);
        buttonBox.append(removeButton);
        box.append(buttonBox);

        this.append(box);

        addButton.connect('clicked', () => this._onAddApp(store));
        removeButton.connect('clicked', () => this._onRemoveApp(store));

        this._loadApps(store);
    }

    _loadApps(store) {
        store.clear();
        let apps = this.settings.get_strv('pinned-apps');
        apps.forEach(app => {
            let iter = store.append();
            store.set(iter, [0], [app]);
        });
    }

    _onAddApp(store) {
        let chooser = new Gtk.FileChooserDialog({
            title: 'Select an Application',
            action: Gtk.FileChooserAction.OPEN,
            transient_for: this.get_root(),
            modal: true,
        });

        chooser.add_button('Cancel', Gtk.ResponseType.CANCEL);
        chooser.add_button('Open', Gtk.ResponseType.OK);

        chooser.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.OK) {
                let file = dialog.get_file();
                if (file) {
                    let path = file.get_path();
                    let appId = path.split('/').pop();
                    let iter = store.append();
                    store.set(iter, [0], [appId]);

                    let apps = this.settings.get_strv('pinned-apps');
                    apps.push(appId);
                    this.settings.set_strv('pinned-apps', apps);
                }
            }
            dialog.destroy();
        });

        chooser.show();
    }

    _onRemoveApp(store) {
        let [hasSelection, model, iter] = store.get_selection().get_selected();
        if (hasSelection) {
            let value = model.get_value(iter, 0);
            model.remove(iter);

            let apps = this.settings.get_strv('pinned-apps');
            let index = apps.indexOf(value);
            if (index > -1) {
                apps.splice(index, 1);
                this.settings.set_strv('pinned-apps', apps);
            }
        }
    }
});

export function init() {}

export function buildPrefsWidget() {
    let settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.app-pinner' });
    return new AppPinnerPrefs(settings);
}
