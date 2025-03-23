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
    
        // Contenitore principale
        this._mainContainer = new St.BoxLayout({
            style_class: 'app-pinner-container',
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER
        });
        this.add_child(this._mainContainer);
    
        // Icona del menu
        this._menuIcon = new St.Icon({
            icon_name: 'view-pin-symbolic',
            style_class: 'system-status-icon app-pinner-menu-icon',
            icon_size: 15
        });
        this._mainContainer.add_child(this._menuIcon);
    
        // Contenitore per le icone pinnate
        this._pinnedIconsBox = new St.BoxLayout({
            style_class: 'app-pinner-icons',
            vertical: false,
            x_expand: true
        });
        this._mainContainer.add_child(this._pinnedIconsBox);
    
        // Inizializza il menu
        this._buildMenu();
        this._loadPinnedApps();
    }

    _buildMenu() {
        this.menu.removeAll();

        // Campo di ricerca
        this._searchEntry = new PopupMenu.PopupBaseMenuItem();
        const searchBox = new St.BoxLayout({ 
            vertical: false, 
            style_class: 'search-box'
        });
        
        this._searchInput = new St.Entry({
            hint_text: _('Cerca applicazioni...'),
            can_focus: true
        });
        searchBox.add_child(this._searchInput);
        this._searchEntry.actor.add_child(searchBox);
        this.menu.addMenuItem(this._searchEntry);

        // Risultati ricerca
        this._resultsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._resultsSection);

        // App pinnate nel menu
        this._pinnedSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._pinnedSection);

        this._searchInput.clutter_text.connect('text-changed', () => this._updateSearch());
    }

    _fuzzyMatch(pattern, str) {
        const patternChars = pattern.toLowerCase().split('');
        const strChars = str.toLowerCase().split('');
        let patternIndex = 0;

        for (const char of strChars) {
            if (char === patternChars[patternIndex]) {
                patternIndex++;
                if (patternIndex === patternChars.length) return true;
            }
        }
        return false;
    }

    async _updateSearch() {
        this._resultsSection.box.destroy_all_children();
        const query = this._searchInput.get_text().trim().toLowerCase();

        if (query.length === 0) {
            this._resultsSection.box.add_child(new PopupMenu.PopupMenuItem(_('Inserisci un termine di ricerca')));
            return;
        }

        const appSys = Shell.AppSystem.get_default();
        const allApps = appSys.get_installed();
        const filteredApps = [];

        for (const app of allApps) {
            if (this._isPinned(app.get_id())) continue;

            const appName = app.get_name().toLowerCase();
            const keywords = appName.split(/[\s-]/);
            
            const matches = 
                appName.includes(query) ||
                keywords.some(k => k.startsWith(query)) ||
                this._fuzzyMatch(query, appName);

            if (matches) {
                filteredApps.push(app);
            }
        }

        // Ordina per rilevanza
        filteredApps.sort((a, b) => {
            const aName = a.get_name().toLowerCase();
            const bName = b.get_name().toLowerCase();
            
            // Priorità 1: Match esatto
            if (aName === query) return -1;
            if (bName === query) return 1;
            
            // Priorità 2: Inizio parola
            const aStarts = aName.startsWith(query);
            const bStarts = bName.startsWith(query);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            
            // Priorità 3: Lunghezza nome
            return aName.length - bName.length;
        });

        // Mostra massimo 10 risultati
        const maxResults = filteredApps.slice(0, 10);
        
        if (maxResults.length === 0) {
            this._resultsSection.box.add_child(new PopupMenu.PopupMenuItem(_('Nessun risultato trovato')));
            return;
        }

        maxResults.forEach(app => {
            const item = new PopupMenu.PopupMenuItem(app.get_name());
            const icon = new St.Icon({
                gicon: app.get_icon(),
                icon_size: 24
            });
            
            item.add_child(icon);
            item.label.x_expand = true;
            
            item.connect('activate', () => {
                this._pinApp(app);
                this._searchInput.set_text('');
                this._updateSearch();
            });
            
            this._resultsSection.box.add_child(item);
        });
    }

    _loadPinnedApps() {
        // Aggiorna topbar
        this._pinnedIconsBox.destroy_all_children();
        const pinnedApps = this._settings.get_strv('pinned-apps');
        pinnedApps.forEach(appId => this._addPinnedIcon(appId));

        // Aggiorna menu
        this._pinnedSection.box.destroy_all_children();
        pinnedApps.forEach(appId => this._addMenuPinnedItem(appId));
    }

    _addPinnedIcon(appId) {
        const app = Gio.DesktopAppInfo.new(appId);
        if (!app) return;

        const icon = new St.Button({
            child: new St.Icon({
                gicon: app.get_icon(),
                icon_size: 24
            }),
            style_class: 'app-pinner-icon',
            reactive: true,
            can_focus: false
        });

        icon.connect('clicked', () => Util.spawn(app.get_commandline().split(' ')));
        this._pinnedIconsBox.add_child(icon);
    }

    _addMenuPinnedItem(appId) {
        const app = Gio.DesktopAppInfo.new(appId);
        if (!app) return;
    
        const item = new PopupMenu.PopupMenuItem(app.get_name());
        const icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: 24
        });
        
        item.insert_child_at_index(icon, 0);
        item.label.x_expand = true;
    
        const removeBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 16,
                style_class: 'app-pinner-remove-icon'
            }),
            style_class: 'app-pinner-remove-btn',
            x_align: Clutter.ActorAlign.END,
            button_mask: St.ButtonMask.ONE
        });
    
        removeBtn.connect('button-press-event', (actor, event) => {
            this._unpinApp(appId);
            this.menu.close();
            this.menu.open();
            return Clutter.EVENT_STOP;
        });
    
        item.add_child(removeBtn);
        this._pinnedSection.box.add_child(item);
    }

    _unpinApp(appId) {
        const current = this._settings.get_strv('pinned-apps');
        const updated = current.filter(id => id !== appId);
        this._settings.set_strv('pinned-apps', updated);
        this._loadPinnedApps();
    }

    _pinApp(app) {
        const current = this._settings.get_strv('pinned-apps');
        if (!current.includes(app.get_id())) {
            current.push(app.get_id());
            this._settings.set_strv('pinned-apps', current);
            this._loadPinnedApps();
        }
    }

    _isPinned(appId) {
        return this._settings.get_strv('pinned-apps').includes(appId);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._pinnedIconsBox.destroy_all_children();
        this._searchInput.destroy();
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