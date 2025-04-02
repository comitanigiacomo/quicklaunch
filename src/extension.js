import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
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
    return appId.replace(/\.desktop$/, '')
               .replace(/^application:\/+/g, ''); // Gestisce qualsiasi numero di slash dopo "application:"
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

    _launchApp(appId) {
        
        try {
            const appSystem = Shell.AppSystem.get_default();
            let app = appSystem.lookup_app(`${appId}.desktop`) || appSystem.lookup_app(appId);
            
    
            if (!app) {
                const desktopApp = Gio.DesktopAppInfo.new(`${appId}.desktop`);
                
                if (desktopApp) {
                    if (this._settings.get_boolean('launch-animation')) {
                        Util.spawnCommandLine(desktopApp.get_commandline());
                    } else {
                        desktopApp.launch([], null);
                    }
                    return;
                }
                console.error(`[ERROR] Applicazione ${appId} non trovata in nessun formato`);
                return;
            }
    
            
            if (this._settings.get_boolean('launch-animation')) {
                app.activate();
            } else {
                const gioApp = Gio.DesktopAppInfo.new(`${appId}.desktop`);
                if (gioApp) {
                    Util.spawnCommandLine(gioApp.get_commandline());
                } else {
                    app.launch(0);
                }
            }
        } catch(e) {
            console.error(`[ERROR] Eccezione durante il lancio:`, e.message);
        }
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

        console.log('[DEBUG] RefreshUI called'); // Aggiungi questo
        
        // Calcola la larghezza massima
        const schema = this._settings.settings_schema;
        const key = schema.get_key('icon-size');
        const range = key.get_range();
        const [minSize, maxIconSize] = range.deep_unpack();
        
        const pinnedApps = this._settings.get_strv('pinned-apps');
        const spacing = this._settings.get_int('spacing');
        const numApps = pinnedApps.length;
        
        // Calcola larghezza come se le icone fossero alla massima dimensione
        const containerWidth = (maxIconSize * numApps) + (spacing * Math.max(0, numApps - 1));
        
        // Applica stili al contenitore principale
        this._mainContainer.set_style(`
            min-width: ${containerWidth}px;
            padding: 0 ${spacing}px;
        `);

        // Aggiorna icone pinnate
        this._pinnedIconsBox.destroy_all_children();
        console.log('[DEBUG] Pinned apps from settings:', pinnedApps); // Aggiungi questo
        pinnedApps.forEach(appId => {
            console.log('[DEBUG] Adding icon for:', appId); // Aggiungi questo
            this._addPinnedIcon(appId);
        });

        // Aggiorna sezione menu
        this._pinnedSection.box.destroy_all_children();
        pinnedApps.forEach(appId => this._addMenuPinnedItem(appId));
    }

    _addPinnedIcon(appId) {

        console.log('[DEBUG] Trying to create icon for:', appId); // Aggiungi questo
        const app = Gio.DesktopAppInfo.new(appId + '.desktop') || 
                Gio.DesktopAppInfo.new(appId);
    
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

        let longPressTimeout = null;
        let isLongPress = false;

        iconButton.connect('button-press-event', (actor, event) => {
            longPressTimeout = setTimeout(() => {
                isLongPress = true;
                this._animateAndMoveToEnd(appId, iconBox);
            }, 500); // 500ms per il long press

            // Animazione di "premuto"
            actor.ease({
                scale_x: 0.8,
                scale_y: 0.8,
                duration: 200
            });

            return Clutter.EVENT_PROPAGATE; // Modificato per permettere il click normale
        });

        iconButton.connect('button-release-event', (actor, event) => {
            if (longPressTimeout) {
                clearTimeout(longPressTimeout);
                longPressTimeout = null;
            }

            // Ripristina scala
            actor.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 200
            });

            return Clutter.EVENT_PROPAGATE;
        });

        iconButton.connect('clicked', () => {
            if (!isLongPress) {
                const app = Gio.DesktopAppInfo.new(`${appId}.desktop`);
                if (app) {
                    if (this._settings.get_boolean('launch-animation')) {
                        Shell.AppSystem.get_default().lookup_app(app.get_id())?.activate();
                    } else {
                        Util.spawn(app.get_commandline().split(' '));
                    }
                }
            }
            isLongPress = false; // Resetta lo stato
        });

        iconBox.opacity = 0;
        iconBox.scale_x = 0.5;
        iconBox.scale_y = 0.5;
        iconBox.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
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

    animateAndMoveToEnd(appId, iconBox) {
        // Animazione avanzata con traiettoria
        iconBox.ease({
            scale_x: 1.5,
            scale_y: 1.5,
            opacity: 0,
            rotation_angle_z: 360, // Rotazione completa
            duration: 800,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // Sposta l'app in fondo
                const current = this._settings.get_strv('pinned-apps');
                const newOrder = current.filter(id => id !== appId).concat(appId);
                this._settings.set_strv('pinned-apps', newOrder);
                
                // Animazione di riapparizione
                this._refreshUIWithEffect();
            }
        });
    }

    _refreshUIWithEffect() {
        // Distruggi le icone con animazione
        this._pinnedIconsBox.get_children().forEach((child, index) => {
            child.ease({
                opacity: 0,
                scale_x: 0.5,
                scale_y: 0.5,
                duration: 300,
                delay: index * 30,
                onComplete: () => child.destroy()
            });
        });

        // Ricrea le icone con nuova animazione
        Clutter.Threads.add_timeout(300, () => {
            this._settings.get_strv('pinned-apps').forEach(appId => 
                this._addPinnedIcon(appId)
            );
            return GLib.SOURCE_REMOVE;
        });
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

    _animateAndMoveToEnd(appId, iconBox) {
        const currentApps = this._settings.get_strv('pinned-apps');
        const currentIndex = currentApps.indexOf(appId);
    
        // Se l'icona è già in ultima posizione, anima il rimbalzo
        if (currentIndex === currentApps.length - 1) {
            // Animazione di rimbalzo
            iconBox.ease({
                scale_x: 1.2,
                scale_y: 1.2,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    iconBox.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 300,
                        mode: Clutter.AnimationMode.EASE_OUT_BOUNCE
                    });
                }
            });
            return;
        }
    
        // Animazione standard per spostamento
        iconBox.ease({
            scale_x: 1.2,
            scale_y: 1.2,
            opacity: 0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                const updatedApps = this._settings.get_strv('pinned-apps');
                const newIndex = updatedApps.indexOf(appId);
                
                // Verifica nuovamente se non è diventata l'ultima nel frattempo
                if (newIndex === updatedApps.length - 1) return;
    
                const newOrder = [
                    ...updatedApps.slice(0, newIndex),
                    ...updatedApps.slice(newIndex + 1),
                    updatedApps[newIndex]
                ];
                
                this._settings.set_strv('pinned-apps', newOrder);
            }
        });
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
            this._launchApp(appId);
            this.menu.close();
        });

        item.add_child(removeBtn);
        this._pinnedSection.box.add_child(item);
    }

    _pinApp(app) {
        const rawAppId = app.get_id();
        const appId = this._sanitizeAppId(rawAppId);
        const maxApps = this._settings.get_int('max-apps');
        
        console.log(`[DEBUG] Max apps setting: ${maxApps}`); // Aggiungi questo
        
        const current = this._settings.get_strv('pinned-apps');
        
        if (current.length >= maxApps) {
            console.error('[ERROR] Impossibile pinnare - Limite massimo raggiunto');
            return;
        }
        
        if (!current.includes(appId)) {
            const updated = [...current, appId];
            this._settings.set_strv('pinned-apps', updated);
            console.log('[SUCCESS] App pinnata correttamente');
            this._refreshUI();
        } else {
            console.log('[DEBUG] App già presente');
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

    _dbusImpl = null;

    enable() {

        // Registra l'interfaccia DBus
        const dbusInterface = `
            <node>
                <interface name="org.gnome.Shell.Extensions.AppPinner">
                    <method name="LaunchPosition">
                        <arg type="u" name="position" direction="in"/>
                    </method>
                </interface>
            </node>`;
        
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(dbusInterface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/AppPinner');

        this._settings = this.getSettings();
        
        // Verifica valori iniziali
        this._validateSettings();
        
        this._positionHandler = this._settings.connect(
            'changed::position-in-panel',
            () => this._safeRecreateIndicator()
        );

        this._keybindings = [];
        for (let i = 1; i <= 10; i++) {
            this._addKeybinding(i);
        }

        this._shortcutHandler = this._settings.connect('changed', () => {
            // Ricarica tutte le scorciatoie
            this._keybindings.forEach(k => Main.wm.removeKeybinding(k));
            this._keybindings = [];
            
            for (let i = 1; i <= 10; i++) {
                const shortcut = this._settings.get_string(`shortcut-${i}`);
                if (shortcut) {
                    this._addKeybinding(i);
                } else {
                    this._removeKeybinding(i); // Aggiungi questa linea
                }
            }
        });

        for (let i = 1; i <= 10; i++) {
            const shortcut = this._settings.get_string(`shortcut-${i}`);
            if (shortcut && !this._validateAccelerator(shortcut)) {
                console.warn(`Scorciatoia ${i} non valida: ${shortcut}`);
                this._settings.set_string(`shortcut-${i}`, '');
            }
        }
        
        this._safeRecreateIndicator();
    }

    _addKeybinding(position) {
        const key = `shortcut-${position}`;
        const shortcut = this._settings.get_string(key);
        
        if (!shortcut) return;

        const customPath = `/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/app-pinner-${position}/`;
        
        const customSettings = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
            path: customPath
        });

        customSettings.set_string('name', `App Pinner Position ${position}`);
        customSettings.set_string('command', `dbus-send --session --type=method_call --dest=org.gnome.Shell /org/gnome/Shell/Extensions/AppPinner org.gnome.Shell.Extensions.AppPinner.LaunchPosition uint32:${position}`);
        customSettings.set_string('binding', shortcut);

        const mediaKeysSettings = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys'
        });
        
        const currentPaths = mediaKeysSettings.get_strv('custom-keybindings');
        if (!currentPaths.includes(customPath)) {
            mediaKeysSettings.set_strv('custom-keybindings', [...currentPaths, customPath]);
        }
    }

    _removeKeybinding(position) {
        const customPath = `/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/app-pinner-${position}/`;
        
        // Rimuovi le impostazioni della scorciatoia
        const customSettings = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
            path: customPath
        });
        customSettings.reset('name');
        customSettings.reset('command');
        customSettings.reset('binding');
    
        // Rimuovi il percorso dalla lista globale
        const mediaKeysSettings = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys'
        });
        
        const currentPaths = mediaKeysSettings.get_strv('custom-keybindings');
        const newPaths = currentPaths.filter(p => p !== customPath);
        mediaKeysSettings.set_strv('custom-keybindings', newPaths);
    }

    LaunchPosition(position) {
        this._launchAppByPosition(position);
    }

    _launchAppByPosition(position) {

        
        console.log(`[KEYBINDING] Shortcut ${position} premuta!`); // <-- Nuovo log
    
        console.log(`[DEBUG] Ricevuta richiesta lancio posizione ${position}`);
        const apps = this._settings.get_strv('pinned-apps');
        console.log(`[DEBUG] App pinnate attuali:`, apps);
        console.log(`[DEBUG] Indicator stato: ${this._indicator ? "OK" : "UNDEFINED"}`);
        
        if (apps.length === 0) {
            console.error('[ERROR] Nessuna applicazione pinnata');
            return;
        }
    
        const index = position - 1;
        console.log(`[DEBUG] Indice calcolato: ${index} (lunghezza array: ${apps.length})`);
    
        if (index < 0 || index >= apps.length) {
            console.error(`[ERROR] Indice non valido: ${index} (max: ${apps.length - 1})`);
            return;
        }
    
        const appId = apps[index];
        console.log(`[DEBUG] Tentativo lancio app ID: ${appId}`);
        console.log(`[DEBUG] AppId in posizione ${position}: ${appId} (Tipo: ${typeof appId})`);

    
        if (!this._indicator) {
            console.error('[ERROR] Indicator non inizializzato');
            return;
        }
    
        // Verifica multipla esistenza app
        const appSys = Shell.AppSystem.get_default();
        let app = appSys.lookup_app(`${appId}.desktop`) || appSys.lookup_app(appId);
        
        if (!app) {
            console.log(`[DEBUG] App non trovata in AppSystem, prova con DesktopAppInfo...`);
            const gioApp = Gio.DesktopAppInfo.new(`${appId}.desktop`) || Gio.DesktopAppInfo.new(appId);
            
            if (!gioApp) {
                console.error(`[ERROR] App ${appId} non trovata in nessun formato`);
                return;
            }
            console.log(`[DEBUG] Trovato DesktopAppInfo:`, gioApp.get_id(), 'Comando:', gioApp.get_commandline());
        } else {
            console.log(`[DEBUG] Trovato in AppSystem:`, app.get_name(), 'ID:', app.get_id());
        }
    
        console.log(`[SUCCESS] Chiamata a _launchApp per ${appId}`);
        this._indicator._launchApp(appId);
    }

    _validateSettings() {
        // Reset valori corrotti
        const currentPos = this._settings.get_string('position-in-panel');
        if (!['left', 'right'].includes(currentPos)) {
            this._settings.set_string('position-in-panel', 'right');
        }
    }

    _validateAccelerator(accelerator) {
        try {
            const [success, keyval] = Gtk.accelerator_parse(accelerator);
            return success && keyval !== 0;
        } catch (e) {
            return false;
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

        // Rimuovi tutte le scorciatoie
        for (let i = 1; i <= 10; i++) {
            this._removeKeybinding(i); // Usa il nuovo metodo
        }
        
        const currentPaths = mediaKeysSettings.get_strv('custom-keybindings');
        const newPaths = currentPaths.filter(p => !p.includes('app-pinner-'));
        mediaKeysSettings.set_strv('custom-keybindings', newPaths);
        if (this._positionHandler) {
            this._settings.disconnect(this._positionHandler);
            this._positionHandler = null;
        }

        this._keybindings.forEach(key => Main.wm.removeKeybinding(key));
        this._keybindings = [];
        
        if (this._indicator) {
            // Rimuovi esplicitamente dal contenitore
            const parent = this._indicator.get_parent();
            if (parent) {
                parent.remove_child(this._indicator);
            }
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings.disconnect(this._shortcutHandler);
    }
}