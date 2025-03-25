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

        // Contenitore principale
        this._mainContainer = new St.BoxLayout({
            style_class: 'app-pinner-container',
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true // Importante per l'altezza
        });
        this.add_child(this._mainContainer);

        // Icona del menu
        this._menuIcon = new St.Icon({
            icon_name: 'view-pin-symbolic',
            style_class: 'system-status-icon app-pinner-menu-icon',
            icon_size: 15
        });
        this._mainContainer.add_child(this._menuIcon);

        // Contenitore icone pinnate
        this._pinnedIconsBox = new St.BoxLayout({
            style_class: 'app-pinner-icons',
            vertical: false, // Layout orizzontale
            x_align: Clutter.ActorAlign.CENTER, // Centra ORIZZONTALMENTE
            y_align: Clutter.ActorAlign.CENTER, // Centra VERTICALMENTE
            x_expand: true,   // Occupa tutta la larghezza
            y_expand: true    // Occupa tutta l'altezza
        });
        this._mainContainer.add_child(this._pinnedIconsBox);

        // Connessioni impostazioni
        this._settingsHandler = [
            this._settings.connect('changed::icon-size', () => this._refreshUI()),
            this._settings.connect('changed::position-in-panel', () => {
                this._mainContainer.x_align = this._getPanelPosition();
            }),
            this._settings.connect('changed::spacing', () => {
                this._pinnedIconsBox.spacing = this._settings.get_int('spacing');
            }),
            this._settings.connect('changed::enable-labels', () => this._refreshUI()),
            this._settings.connect('changed::pinned-apps', () => this._refreshUI())
        ];

        this._buildMenu();
        this._refreshUI();
    }

    _getPanelPosition() {
        switch (this._settings.get_string('position-in-panel')) {
            case 'Left': return Clutter.ActorAlign.START;
            case 'Right': return Clutter.ActorAlign.END;
            default: return Clutter.ActorAlign.CENTER;
        }
    }

    _buildMenu() {
        this.menu.removeAll();

        // Barra di ricerca
        const searchEntry = new PopupMenu.PopupBaseMenuItem();
        const searchBox = new St.BoxLayout({
            vertical: false,
            style_class: 'search-box',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL
        });
        
        this._searchInput = new St.Entry({
            hint_text: _('Search applications...'),
            can_focus: true,
            x_expand: true
        });
        
        searchBox.add_child(this._searchInput);
        searchEntry.actor.add_child(searchBox);
        this.menu.addMenuItem(searchEntry);

        // Sezione risultati
        this._resultsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._resultsSection);

        // Sezione pinnati
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._pinnedSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._pinnedSection);

        this._searchInput.clutter_text.connect('text-changed', () => this._updateSearch());
    }

    async _updateSearch() {
        this._resultsSection.box.destroy_all_children();
        const query = this._searchInput.get_text().trim().toLowerCase();
        if (!query) return;

        const iconSize = this._settings.get_int('icon-size');
        const appSys = Shell.AppSystem.get_default();
        
        const results = appSys.get_installed()
            .filter(app => {
                const appId = this._sanitizeAppId(app.get_id());
                return !this._isPinned(appId) && 
                    this._matchQuery(query, app.get_name().toLowerCase());
            })
            .sort((a, b) => this._sortApps(a, b, query))
            .slice(0, 10);

        if (results.length === 0) {
            this._resultsSection.box.add_child(
                new PopupMenu.PopupMenuItem(_('No results found'))
            );
            return;
        }

        results.forEach(app => {
            const item = new PopupMenu.PopupMenuItem(app.get_name());
            const icon = new St.Icon({
                gicon: app.get_icon(),
                icon_size: iconSize
            });
            item.insert_child_at_index(icon, 0);
            
            item.connect('activate', () => {
                this._pinApp(app);
                app.launch();
                this._searchInput.set_text('');
                this._updateSearch();
            });
            
            this._resultsSection.box.add_child(item);
        });
    }

    _sanitizeAppId(appId) {
        return appId.replace('.desktop', '');
    }

    _matchQuery(query, appName) {
        const keywords = appName.split(/[\s-]/);
        return appName.includes(query) ||
               keywords.some(k => k.startsWith(query)) ||
               this._fuzzyMatch(query, appName);
    }

    _fuzzyMatch(pattern, str) {
        let patternIndex = 0;
        for (const char of str.toLowerCase()) {
            if (char === pattern[patternIndex]) {
                if (++patternIndex === pattern.length) return true;
            }
        }
        return false;
    }

    _sortApps(a, b, query) {
        const aName = a.get_name().toLowerCase();
        const bName = b.get_name().toLowerCase();
        
        if (aName === query) return -1;
        if (bName === query) return 1;
        
        const aStart = aName.startsWith(query);
        const bStart = bName.startsWith(query);
        if (aStart !== bStart) return aStart ? -1 : 1;
        
        return aName.length - bName.length;
    }

    _refreshUI() {
        if (this._destroyed) return;
        
        // Aggiorna icone pinnate
        this._pinnedIconsBox.destroy_all_children();
        this._settings.get_strv('pinned-apps').forEach(appId => 
            this._addPinnedIcon(appId)
        );

        // Aggiorna sezione menu
        this._pinnedSection.box.destroy_all_children();
        this._settings.get_strv('pinned-apps').forEach(appId => 
            this._addMenuPinnedItem(appId)
        );
    }

    _addPinnedIcon(appId) {
        const app = Gio.DesktopAppInfo.new(`${appId}.desktop`);
        if (!app) {
            console.error(`Applicazione non trovata: ${appId}`);
            return;
        }

        const iconSize = this._settings.get_int('icon-size');
        const showLabels = this._settings.get_boolean('enable-labels');

        const iconBox = new St.BoxLayout({ 
            vertical: true,
            style_class: 'app-pinner-icon-box',
            y_expand: true
        });

        const iconButton = new St.Button({
            child: new St.Icon({ 
                gicon: app.get_icon(),
                icon_size: this._settings.get_int('icon-size')
            }),
            style_class: 'app-pinner-icon',
            reactive: true,
            hover: true,
            track_hover: true
        });

        iconButton.connect('clicked', () => {
            if (this._settings.get_boolean('launch-animation')) {
                Shell.AppSystem.get_default().lookup_app(app.get_id())?.activate();
            } else {
                Util.spawn(app.get_commandline().split(' '));
            }
            this.menu.close();
        });

        if (showLabels) {
            iconBox.add_child(new St.Label({
                text: app.get_name(),
                style_class: 'app-pinner-label'
            }));
        }

        iconBox.add_child(iconButton);
        this._pinnedIconsBox.add_child(iconBox);
    }

    _addMenuPinnedItem(appId) {
        const app = Gio.DesktopAppInfo.new(`${appId}.desktop`);
        if (!app) {
            console.error(`Applicazione non trovata nel menu: ${appId}`);
            return;
        }

        const item = new PopupMenu.PopupMenuItem(app.get_name());
        const icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: this._settings.get_int('icon-size')
        });
        item.insert_child_at_index(icon, 0);

        // Aggiungi uno spacer per spingere il pulsante di rimozione a destra
        const spacer = new St.BoxLayout({ x_expand: true });
        item.actor.add_child(spacer);

        // Pulsante rimozione
        const removeBtn = new St.Button({
            child: new St.Label({ 
                text: '×',
                style_class: 'app-pinner-remove-label'
            }),
            style_class: 'app-pinner-remove-btn'
        });

        removeBtn.connect('button-press-event', (actor, event) => {
            this._unpinApp(appId);
            this.menu.close();
            this.menu.open();
            return Clutter.EVENT_STOP;
        });

        item.connect('activate', () => {
            Util.spawn(app.get_commandline().split(' '));
            this.menu.close();
        });

        item.add_child(removeBtn);
        this._pinnedSection.box.add_child(item);
    }

    _pinApp(app) {
        const rawAppId = app.get_id();
        const appId = this._sanitizeAppId(rawAppId);
        const current = this._settings.get_strv('pinned-apps');
        
        if (current.length < this._settings.get_int('max-apps') && 
           !current.includes(appId)) {
            const updated = [...current, appId];
            this._settings.set_strv('pinned-apps', updated);
            this._refreshUI(); // Forza aggiornamento immediato
        }
    }

    _unpinApp(appId) {
        const current = this._settings.get_strv('pinned-apps');
        const updated = current.filter(id => id !== appId);
        this._settings.set_strv('pinned-apps', updated);
    }

    _isPinned(appId) {
        const cleanAppId = this._sanitizeAppId(appId);
        return this._settings.get_strv('pinned-apps').includes(cleanAppId);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        this._settingsHandler?.forEach(h => this._settings.disconnect(h));
        this._settingsHandler = null;

        this._pinnedIconsBox?.destroy();
        this._searchInput?.destroy();
        
        super.destroy();
    }
});

export default class AppPinnerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        
        // Inizializza app predefinite se necessario
        const pinnedApps = this._settings.get_strv('pinned-apps');
        if (pinnedApps.length === 0) {
            const defaultApps = this._settings.get_strv('default-apps')
                .map(app => app.replace('.desktop', ''));
            this._settings.set_strv('pinned-apps', defaultApps);
        }

        this._indicator = new AppPinner(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}