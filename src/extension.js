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
        this._draggedIcon = null;
        this._dragStartX = 0;
        this._currentIndex = -1;
        this._dragClone = null;
        this._dragOriginIndex = -1;
        this._dragOriginPosition = 0;

        // Contenitore principale
        this._mainContainer = new St.BoxLayout({
            style_class: 'panel-button',
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true
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
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,   // Occupa tutta la larghezza
            y_expand: true    // Occupa tutta l'altezza
        });
        this._mainContainer.add_child(this._pinnedIconsBox);

        this._updateIconsSpacing();

        // Connessioni impostazioni
        this._settingsHandler = [
            this._settings.connect('changed::icon-size', () => this._refreshUI()),
            this._settings.connect('changed::spacing', () => {
                this._updateIconsSpacing();
                this._pinnedIconsBox.queue_relayout();
            }),
            this._settings.connect('changed::enable-labels', () => this._refreshUI()),
            this._settings.connect('changed::pinned-apps', () => this._refreshUI())
        ];

        this.menu.actor.connect('button-press-event', (actor, event) => {
            const target = event.get_source();
            // Chiudi solo se il click è FUORI dal menu
            if (!this.menu.actor.contains(target)) {
                this.menu.close();
            }
        });

        this._buildMenu();
        this._refreshUI();
    }

    _updateIconsSpacing() {
        const spacing = Math.min(20, Math.max(0, this._settings.get_int('spacing')));
        this._pinnedIconsBox.set_style(`spacing: ${spacing}px;`);
    }

    _getPanelPosition() {
        const position = this._settings.get_string('position-in-panel');
        return {
            left: Clutter.ActorAlign.START,
            center: Clutter.ActorAlign.CENTER,
            right: Clutter.ActorAlign.END
        }[position] || Clutter.ActorAlign.FILL;
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
    
            // 1. Resetta la ricerca PRIMA di lanciare l'app
            this._searchInput.set_text('');
            this._updateSearch();
            
            // 2. Chiudi il menu dopo aver aggiornato l'UI
            this.menu.close();
            
            // 3. Lancia l'applicazione
            app.launch();
            });
            
            this._resultsSection.box.add_child(item);
        });

        this.menu.actor.show_all();
        this.menu.actor.queue_redraw();
        
        // Aggiorna il layout
        Clutter.Threads.add_timeout(0, () => {
            this.menu.queue_relayout();
            return GLib.SOURCE_REMOVE;
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

        // Drag-and-drop handlers
        iconButton.connect('button-press-event', (actor, event) => {
            // Crea un clone dell'icona
            this._dragClone = new St.Icon({
                gicon: app.get_icon(),
                icon_size: iconSize,
                style_class: 'app-pinner-drag-clone',
                opacity: 200
            });
            
            // Posiziona il clone alle coordinate del cursore
            const [stageX, stageY] = event.get_coords();
            this._dragClone.set_position(stageX - iconSize/2, stageY - iconSize/2);
            Main.uiGroup.add_child(this._dragClone);

            // Memorizza la posizione originale
            this._dragOriginIndex = this._pinnedIconsBox.get_children().indexOf(iconBox);
            this._dragOriginPosition = iconBox.get_allocation_box().x1;
            
            // Nascondi l'originale durante il trascinamento
            iconBox.opacity = 50;
            
            return Clutter.EVENT_STOP;
        });


        iconButton.connect('button-release-event', (actor, event) => {
            if (!this._dragClone) return Clutter.EVENT_STOP;
        
            try {
                const pinnedBox = this._pinnedIconsBox.get_allocation_box();
                if (!pinnedBox) {
                    console.error('Impossibile ottenere la posizione del contenitore');
                    return Clutter.EVENT_STOP;
                }
        
                const [stageX] = event.get_coords();
                const relativeX = stageX - pinnedBox.x1;
                const children = this._pinnedIconsBox.get_children();
                
                // Calcola la larghezza corretta
                const iconSize = this._settings.get_int('icon-size');
                const spacing = this._settings.get_int('spacing');
                const iconWidth = iconSize + spacing;
        
                let newIndex = Math.floor(relativeX / iconWidth);
                newIndex = Math.max(0, Math.min(newIndex, children.length - 1));
        
                if (newIndex !== this._dragOriginIndex) {
                    this._reorderIcons(this._dragOriginIndex, newIndex);
                    this._saveNewOrder();
                }
            } catch (e) {
                console.error('Errore durante il riordinamento:', e);
            } finally {
                iconBox.opacity = 255;
                this._dragClone.destroy();
                this._dragClone = null;
            }
            
            return Clutter.EVENT_STOP;
        });

        iconButton.connect('motion-event', (actor, event) => {
            if (!this._dragClone) return Clutter.EVENT_PROPAGATE;

            // Aggiorna la posizione del clone
            const [stageX, stageY] = event.get_coords();
            const iconSize = this._settings.get_int('icon-size');
            this._dragClone.set_position(
                stageX - iconSize/2,
                stageY - iconSize/2
            );

            return Clutter.EVENT_STOP;
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
        iconBox.appId = appId;  // Memorizza l'ID dell'app
    }
    
    _calculateNewPosition(delta) {
        const children = this._pinnedIconsBox.get_children();
        const spacing = this._settings.get_int('spacing');
        const iconWidth = this._settings.get_int('icon-size') + spacing;
        return Math.min(
            children.length - 1,
            Math.max(0, this._currentIndex + Math.round(delta / iconWidth))
        );
    }
    
    _reorderIcons(oldIndex, newIndex) {
        if (oldIndex === newIndex) return;
        
        const children = this._pinnedIconsBox.get_children();
        if (oldIndex < 0 || oldIndex >= children.length || newIndex < 0 || newIndex >= children.length) {
            console.error('Indici non validi per il riordinamento:', oldIndex, newIndex);
            return;
        }
    
        const item = children[oldIndex];
        this._pinnedIconsBox.remove_child(item);
        this._pinnedIconsBox.insert_child_at_index(item, newIndex);
    }

    _saveNewOrder() {
        const newOrder = this._pinnedIconsBox.get_children()
            .map(child => child.appId)
            .filter(id => id && typeof id === 'string');
    
        if (arraysEqual(newOrder, this._settings.get_strv('pinned-apps'))) return;
    
        try {
            this._settings.set_strv('pinned-apps', newOrder);
        } catch (e) {
            console.error('Errore nel salvataggio delle impostazioni:', e);
        }
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

function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

export default class AppPinnerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        
        // Verifica valori iniziali
        this._validateSettings();
        
        this._positionHandler = this._settings.connect(
            'changed::position-in-panel',
            () => this._safeRecreateIndicator()
        );
        
        this._safeRecreateIndicator();
    }

    _validateSettings() {
        // Reset valori corrotti
        const currentPos = this._settings.get_string('position-in-panel');
        if (!['left', 'right'].includes(currentPos)) {
            this._settings.set_string('position-in-panel', 'right');
        }
    }

    _safeRecreateIndicator() {
        // Salva stato corrente
        const iconSize = this._settings.get_int('icon-size');
        const spacing = this._settings.get_int('spacing');
        const labels = this._settings.get_boolean('enable-labels');

        // Ricrea indicatore
        this._recreateIndicator();

        // Ripristina impostazioni
        this._settings.set_int('icon-size', iconSize);
        this._settings.set_int('spacing', spacing);
        this._settings.set_boolean('enable-labels', labels);
    }

    _recreateIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    
        this._indicator = new AppPinner(this._settings);
        const position = this._settings.get_string('position-in-panel');
        
        // Rimuovi da eventuali contenitori precedenti
        if (this._indicator.get_parent()) {
            this._indicator.get_parent().remove_child(this._indicator);
        }
    
        switch(position) {
            case 'left':
                Main.panel._leftBox.insert_child_at_index(this._indicator, 0);
                break;
                
            case 'center':
                // Posizione centrale tra left e right
                if (Main.panel._centerBox) {
                    Main.panel._centerBox.add_child(this._indicator);
                } else {
                    // Fallback per vecchie versioni GNOME
                    Main.panel._centerBox = new St.BoxLayout();
                    Main.panel._centerBox.x_align = Clutter.ActorAlign.CENTER;
                    Main.panel.insert_child_at_index(Main.panel._centerBox, 1);
                    Main.panel._centerBox.add_child(this._indicator);
                }
                break;
                
            case 'right':
                const dateMenu = Main.panel.statusArea?.dateMenu;
                let targetIndex = 0;
                if (dateMenu?.actor) {
                    const children = Main.panel._rightBox.get_children();
                    const dateMenuIndex = children.indexOf(dateMenu.actor);
                    targetIndex = dateMenuIndex !== -1 ? dateMenuIndex + 1 : 0;
                }
                Main.panel._rightBox.insert_child_at_index(this._indicator, targetIndex);
                break;
        }
    
        // Stile dinamico
        this._indicator.set_style_class_name(
            `app-pinner-position-${position}`
        );
    
        Main.panel.queue_relayout();
        Main.panel.menuManager.addMenu(this._indicator.menu);
    }

    disable() {
        if (this._positionHandler) {
            this._settings.disconnect(this._positionHandler);
            this._positionHandler = null;
        }
        
        if (this._indicator) {
            // Rimuovi esplicitamente dal contenitore
            const parent = this._indicator.get_parent();
            if (parent) {
                parent.remove_child(this._indicator);
            }
            this._indicator.destroy();
            this._indicator = null;
        }
        
        Util.garbageCollect();
    }
}