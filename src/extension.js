/* extension.js */
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const AppPinner = GObject.registerClass(
class AppPinner extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, _('App Pinner'));
        this._settings = settings;
        this._destroyed = false;

        // Icona principale
        this._icon = new St.Icon({
            icon_name: 'view-pin-symbolic',
            style_class: 'system-status-icon'
        });
        this.add_child(this._icon);

        // Inizializza il menu
        this._buildMenu();
        this._loadPinnedApps();
    }

    _buildMenu() {
        this.menu.removeAll();

        // Campo di ricerca
        this._searchEntry = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false
        });
        
        const searchBox = new St.BoxLayout({ vertical: false });
        this._searchEntry.actor.add_child(searchBox);
        
        this._searchInput = new St.Entry({
            hint_text: _('Cerca applicazioni...'),
            track_hover: true,
            can_focus: true
        });
        searchBox.add_child(this._searchInput);  // Corretto qui
        
        this.menu.addMenuItem(this._searchEntry);

        // Risultati ricerca
        this._resultsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._resultsSection);

        // App pinnate
        this._pinnedSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._pinnedSection);

        // Connessione eventi
        this._searchInput.clutter_text.connect('text-changed', () => this._updateSearch());
    }

    async _updateSearch() {
        const query = this._searchInput.get_text().toLowerCase();
        this._resultsSection.box.destroy_all_children();

        if (query.length < 2) {
            this._resultsSection.box.add_child(new PopupMenu.PopupMenuItem(_('Inserisci almeno 2 caratteri')));
            return;
        }

        const appSys = Shell.AppSystem.get_default();
        const apps = appSys.get_installed().filter(app => 
            app.get_name().toLowerCase().includes(query) && 
            !this._isPinned(app.get_id())
        );

        apps.forEach(app => {
            const item = new PopupMenu.PopupMenuItem(app.get_name());
            item.icon = new St.Icon({ 
                gicon: app.get_icon(), 
                icon_size: 16 
            });
            
            item.connect('activate', () => {
                this._pinApp(app);
                this._searchInput.set_text('');
                this._updateSearch();
            });
            
            this._resultsSection.box.add_child(item);
        });
    }

    _loadPinnedApps() {
        this._pinnedSection.box.destroy_all_children();
        const pinnedApps = this._settings.get_strv('pinned-apps');

        pinnedApps.forEach(appId => {
            const app = Gio.DesktopAppInfo.new(appId);
            if (!app) return;

            const item = new PopupMenu.PopupMenuItem(app.get_name());
            item.icon = new St.Icon({ 
                gicon: app.get_icon(), 
                icon_size: 16 
            });

            // Pulsante rimozione
            const removeBtn = new St.Button({
                child: new St.Icon({ 
                    icon_name: 'window-close-symbolic',
                    style_class: 'app-pinner-remove-icon'
                }),
                style_class: 'app-pinner-remove-btn'
            });
            
            item.actor.add_child(removeBtn);
            removeBtn.connect('clicked', (event) => {
                event.stop_propagation();
                this._unpinApp(appId);
            });
            
            this._pinnedSection.box.add_child(item);
        });
    }

    _pinApp(app) {
        const current = this._settings.get_strv('pinned-apps');
        if (!current.includes(app.get_id())) {
            current.push(app.get_id());
            this._settings.set_strv('pinned-apps', current);
            this._loadPinnedApps();
        }
    }

    _unpinApp(appId) {
        const current = this._settings.get_strv('pinned-apps');
        const updated = current.filter(id => id !== appId);
        this._settings.set_strv('pinned-apps', updated);
        this._loadPinnedApps();
    }

    _isPinned(appId) {
        return this._settings.get_strv('pinned-apps').includes(appId);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        
        this._searchInput.destroy();
        this._resultsSection.destroy();
        this._pinnedSection.destroy();
        super.destroy();
    }
});

export default class AppPinnerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new AppPinner(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}