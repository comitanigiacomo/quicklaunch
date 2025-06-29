import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const AppPinner = GObject.registerClass(
    class AppPinner extends PanelMenu.Button {

        // 1. Costruttore e inizializzazione
        _init(settings) {
            super._init(0.0, _('App Pinner'));
            this._settings = settings;
            this._destroyed = false;
            this._pendingApps = new Set();
            this._settingsHandler = [];
            this._longPressTimeoutId = null;

            this._windowTracker = Shell.WindowTracker.get_default();
            this._windowTracker.connect('tracked-windows-changed', this._updateRunningIndicators.bind(this));

            this._settingsHandler.push(
                this._settings.connect('changed::show-in-panel', () => this._updateVisibility()),
                this._settings.connect('changed::sort-alphabetically', () => this._refreshUI())
            );

            this._appSystem = Shell.AppSystem.get_default();
            this._runningTracker = new Set();
            this._appStateChangedId = this._appSystem.connect('app-state-changed',
                () => this._updateRunningIndicators());

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
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true
            });
            this._mainContainer.add_child(this._pinnedIconsBox);

            this._updateIconsSpacing();

            // Connessioni impostazioni
            this._settingsHandler.push(
                this._settings.connect('changed::icon-size', () => this._refreshUI()),
                this._settings.connect('changed::spacing', () => {
                    this._updateIconsSpacing();
                    this._pinnedIconsBox.queue_relayout();
                }),
                this._settings.connect('changed::enable-labels', () => this._refreshUI()),
                this._settings.connect('changed::pinned-apps', () => this._refreshUI()),
                this._settings.connect('changed::indicator-color', () => {
                    this._updateIndicatorColor();
                    this._updateRunningIndicators();
                })
            );


            this.menu.actor.connect('button-press-event', (actor, event) => {
                const target = event.get_source();

                if (!this.menu.actor.contains(target)) {
                    this.menu.close();
                }
            });

            this._buildMenu();
            this._refreshUI();

            this._logindProxy = new Gio.DBusProxy({
                g_connection: Gio.DBus.system,
                g_interface_name: 'org.freedesktop.login1.Manager',
                g_object_path: '/org/freedesktop/login1',
                g_name: 'org.freedesktop.login1'
            });

            this._logindProxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
                try {
                    this._logindProxy.init_finish(res);
                    this._logindId = this._logindProxy.connectSignal('PrepareForSleep',
                        this._handleSleepSignal.bind(this));
                } catch (e) {
                    console.error('Errore inizializzazione proxy login1:', e.message);
                }
            });

            this._appStateChangedId = this._appSystem.connect('app-state-changed', () => {
                this._addTimeout(100, () => {
                    this._updateRunningIndicators();
                    return GLib.SOURCE_REMOVE;
                });
            });

            this._settingsHandler.push(
                this._settings.connect('changed::custom-links', () => this._refreshUI())
            );

            this._timeoutIds = new Set();

        }

        _updateVisibility() {
            const showInPanel = this._settings.get_boolean('show-in-panel');
            this._pinnedIconsBox.visible = showInPanel;
            this._menuIcon.visible = true;
            this._pinnedIconsBox.queue_relayout();
            this.queue_relayout();
        }

        _addTimeout(interval, callback) {
            const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                const result = callback();
                this._timeoutIds.delete(sourceId);
                return result;
            });
            this._timeoutIds.add(sourceId);
            return sourceId;
        }

        // 2. Metodi lifecycle e gestione stato
        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;

            if (this._logindId && this._logindProxy) {
                this._logindProxy.disconnect(this._logindId);
                this._logindProxy = null;
            }

            this._settingsHandler?.forEach(h => this._settings.disconnect(h));
            this._settingsHandler = null;

            this._pinnedIconsBox?.destroy();
            this._searchInput?.destroy();

            if (this._appStateChangedId) {
                this._appSystem.disconnect(this._appStateChangedId);
                this._appStateChangedId = null;
            }

            if (this._timeoutIds) {
                this._timeoutIds.forEach(id => GLib.Source.remove(id));
                this._timeoutIds.clear();
            }

            if (this._longPressTimeoutId !== null) {
                GLib.Source.remove(this._longPressTimeoutId);
                this._timeoutIds.delete(this._longPressTimeoutId);
                this._longPressTimeoutId = null;
            }

            super.destroy();
        }

        // 3. Costruzione UI principale
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

            // Sezione aggiungi link
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const linkSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(linkSection);

            const linkBox = new St.BoxLayout({
                vertical: false,
                style_class: 'app-pinner-link-box',
                x_expand: true,
                margin_top: 6,
                margin_bottom: 6
            });
            this._linkInput = new St.Entry({
                hint_text: _('Enter URL...'),
                can_focus: true,
                style_class: 'app-pinner-link-input'
            });

            const addLinkBtn = new St.Button({
                style_class: 'app-pinner-add-link-btn',
                label: _('Add'),
                can_focus: true,
                x_align: Clutter.ActorAlign.END
            });

            addLinkBtn.connect('clicked', () => {
                const url = this._linkInput.get_text().trim();
                if (this._isValidUrl(url)) {
                    this._pinLink(url);
                    this._linkInput.set_text('');
                    this.menu.close();
                }
            });

            linkBox.add_child(this._linkInput);
            linkBox.add_child(addLinkBtn);
            linkSection.actor.add_child(linkBox);
        }

        _addPinnedIcon(appId) {

            if (appId.startsWith('link://')) {
                const url = appId.replace('link://', '');
                return this._addLinkIcon(url);
            }


            const app = Gio.DesktopAppInfo.new(appId + '.desktop') ||
                Gio.DesktopAppInfo.new(appId);

            if (!app) {
                const altPaths = [
                    GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'applications', `${appId}.desktop`]),
                    `/var/lib/flatpak/exports/share/applications/${appId}.desktop`,
                    `${GLib.get_home_dir()}/.local/share/flatpak/exports/share/applications/${appId}.desktop`
                ];

                for (const path of altPaths) {
                    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                        const altApp = Gio.DesktopAppInfo.new_from_filename(path);
                        if (altApp) {
                            app = altApp;
                            break;
                        }
                    }
                }

                if (!app) {
                    console.error(`[CRITICAL] App not found in any location: ${appId}`);
                    return;
                }
            }

            const showLabels = this._settings.get_boolean('enable-labels');

            const iconBox = new St.BoxLayout({
                vertical: true,
                style_class: 'app-pinner-icon-box',
                y_expand: true
            });

            const iconContainer = new St.Bin({
                style_class: 'app-pinner-icon-container',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
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

            const runningIndicator = new St.Widget({
                style_class: 'app-pinner-running-indicator',
                visible: false,
                reactive: false,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.START,
                x_expand: false,
                y_expand: false,
                translation_x: +9,
                translation_y: -9
            });

            this._updateIndicatorColor(runningIndicator);

            this._settings.connect('changed::indicator-color',
                () => this._updateIndicatorColor(runningIndicator));


            iconContainer.add_child(iconButton);
            iconContainer.add_child(runningIndicator);

            iconBox.runningIndicator = runningIndicator;

            let pressStartTime = 0;
            let longPressTimeoutId = null;
            let isLongPress = false;

            iconButton.connect('button-press-event', (actor, event) => {

                if (longPressTimeoutId !== null) {
                    GLib.Source.remove(longPressTimeoutId);
                    this._timeoutIds.delete(longPressTimeoutId);
                    this._longPressTimeoutId = null;
                }

                pressStartTime = Date.now();
                isLongPress = false;

                longPressTimeoutId = this._addTimeout(500, () => {
                    isLongPress = true;
                    this._animateAndMoveToEnd(appId, iconBox);
                    this._longPressTimeoutId = null; 
                    return GLib.SOURCE_REMOVE;
                });

                actor.ease({
                    scale_x: 0.8,
                    scale_y: 0.8,
                    duration: 200
                });
                return Clutter.EVENT_PROPAGATE;
            });

            iconButton.connect('button-release-event', (actor, event) => {
                if (longPressTimeoutId !== null) {
                    GLib.Source.remove(longPressTimeoutId);
                    this._timeoutIds.delete(longPressTimeoutId);
                    longPressTimeoutId = null;
                }

                actor.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 200
                });
                return Clutter.EVENT_PROPAGATE;
            });

            iconButton.connect('clicked', () => {
                if (!isLongPress) {
                    this._launchApp(appId);
                }
                isLongPress = false;
            });

            iconBox.add_child(iconContainer);

            if (showLabels) {
                iconBox.add_child(new St.Label({
                    text: app.get_name(),
                    style_class: 'app-pinner-label'
                }));
            }

            this._pinnedIconsBox.add_child(iconBox);
            iconBox.appId = appId;

            this._updateRunningIndicator(appId, runningIndicator);

            return iconBox;
        }

        _addLinkIcon(url) {
            const appId = `link://${url}`;
            const iconSize = this._settings.get_int('icon-size');
            const showLabels = this._settings.get_boolean('enable-labels');

            const iconBox = new St.BoxLayout({
                vertical: true,
                style_class: 'app-pinner-icon-box'
            });

            const iconButton = new St.Button({
                child: new St.Icon({
                    icon_name: 'emblem-web-symbolic',
                    icon_size: iconSize,
                    style_class: 'app-pinner-link-icon'
                }),
                style_class: 'app-pinner-icon',
                reactive: true,
                hover: true,
                track_hover: true
            });

            iconButton.connect('notify::hover', () => {
                iconButton.style = iconButton.hover
                    ? 'background: rgba(255,255,255,0.1); border-radius: 6px;'
                    : '';
            });

            let pressStartTime = 0;
            let longPressTimeoutId = null;
            let isLongPress = false;

            iconButton.connect('button-press-event', (actor, event) => {

                pressStartTime = Date.now();
                isLongPress = false;

                longPressTimeoutId = this._addTimeout(500, () => {
                    isLongPress = true;
                    this._animateAndMoveToEnd(appId, iconBox);
                    return GLib.SOURCE_REMOVE;
                });

                actor.ease({
                    scale_x: 0.8,
                    scale_y: 0.8,
                    duration: 200
                });

                return Clutter.EVENT_PROPAGATE;
            });

            iconButton.connect('button-release-event', (actor, event) => {
                if (longPressTimeoutId !== null) {
                    GLib.Source.remove(longPressTimeoutId);
                    this._timeoutIds.delete(longPressTimeoutId);
                    longPressTimeoutId = null;
                }

                actor.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 200
                });

                return Clutter.EVENT_PROPAGATE;
            });

            iconButton.connect('clicked', () => {
                if (!isLongPress) {
                    Gio.AppInfo.launch_default_for_uri(url, null);
                }
                isLongPress = false;
            });

            const container = new St.Bin();
            container.add_child(iconButton);
            iconBox.add_child(container);

            if (showLabels) {
                const label = new St.Label({
                    text: this._shortenUrl(url),
                    style_class: 'app-pinner-label',
                    x_align: Clutter.ActorAlign.CENTER
                });
                iconBox.add_child(label);
            }

            iconBox.appId = appId;
            this._pinnedIconsBox.add_child(iconBox);

            return iconBox;
        }

        _checkVisibility() {
            if (this._destroyed) return;
            this._updateVisibility();
            this._addTimeout(2000, () => {
                this._checkVisibility();
                return GLib.SOURCE_REMOVE;
            });
        }

        // 4. Gestione interazioni utente
        _launchApp(appId) {

            if (appId.startsWith('link://')) {
                const url = appId.replace('link://', '');
                Gio.AppInfo.launch_default_for_uri(url, null);
                return;
            }
            try {
                const appSystem = Shell.AppSystem.get_default();
                let app = appSystem.lookup_app(`${appId}.desktop`) || appSystem.lookup_app(appId);

                if (!app) {
                    const desktopApp = Gio.DesktopAppInfo.new(`${appId}.desktop`);
                    if (desktopApp) {
                        app = new Shell.App({ desktop_app_info: desktopApp });
                    }
                    if (!app) {
                        console.error(`[ERROR] Application ${appId} not found`);
                        return;
                    }
                }

                this._pendingApps.add(appId);

                app.activate();

                this._forceImmediateUpdate(appId);

                this._addTimeout(1500, () => {
                    this._pendingApps.delete(appId);
                    this._updateRunningIndicators();
                    this._addTimeout(500, () => {
                        this._updateRunningIndicators();
                        return GLib.SOURCE_REMOVE;
                    });
                    return GLib.SOURCE_REMOVE;
                });

            } catch (e) {
                this._pendingApps.delete(appId);
            }

            this._pendingApps.add(appId);
            this._updateRunningIndicators();
        }

        _handleSleepSignal(sender, signalName, params) {
            const [isSleeping] = params.deepUnpack();
            if (!isSleeping) {
                this._addTimeout(1000, () => {
                    this._updateVisibility();
                    this._forceFullRefresh();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        // 5. Gestione stato applicazioni
        _updateRunningIndicators() {
            const children = this._pinnedIconsBox.get_children();

            children.forEach(iconBox => {
                const appId = iconBox.appId;
                if (!appId || appId.startsWith('link://')) return;
                this._updateRunningIndicator(appId, iconBox.runningIndicator);
            });
        }

        _updateRunningIndicator(appId, indicator) {
            let isRunning = false;

            if (this._pendingApps.has(appId)) {
                isRunning = true;
            } else {
                const app = this._findAppById(appId);
                if (app) {
                    const state = app.get_state();
                    const hasWindows = app.get_windows().length > 0;
                    const isInAppSystem = this._appSystem.get_running().some(a => a.get_id() === app.get_id());

                    isRunning = state === Shell.AppState.RUNNING || hasWindows || isInAppSystem;

                }
            }

            if (indicator.visible !== isRunning) {
                indicator.visible = isRunning;

                if (isRunning) {
                    indicator.ease({
                        scale_x: 1.2,
                        scale_y: 1.2,
                        opacity: 200,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            indicator.ease({
                                scale_x: 1.0,
                                scale_y: 1.0,
                                opacity: 255,
                                duration: 300
                            });
                        }
                    });
                } else {
                    indicator.set_scale(1.0, 1.0);
                    indicator.opacity = 255;
                }
            }

            if (!isRunning && this._pendingApps.has(appId)) {
                this._pendingApps.delete(appId);
            }
        }

        // 6. Gestione impostazioni e aggiornamenti UI
        _refreshUI() {
            if (this._destroyed) return;

            const schema = this._settings.settings_schema;
            const key = schema.get_key('icon-size');
            const range = key.get_range();
            const [minSize, maxIconSize] = range.deep_unpack();

            let pinnedApps = this._settings.get_strv('pinned-apps');

            if (this._settings.get_boolean('sort-alphabetically') && pinnedApps.length > 0) {
                const sortedApps = [...pinnedApps].sort((a, b) => {
                    const nameA = this._getAppOrLinkName(a).toLowerCase();
                    const nameB = this._getAppOrLinkName(b).toLowerCase();
                    return nameA.localeCompare(nameB);
                });

                if (!arraysEqual(pinnedApps, sortedApps)) {
                    const handler = this._settings.connect('changed::pinned-apps', () => { });
                    this._settings.set_strv('pinned-apps', sortedApps);
                    this._settings.disconnect(handler);
                    return;
                }
            }

            const spacing = this._settings.get_int('spacing');
            const totalItems = pinnedApps.length;

            const containerWidth = (maxIconSize * totalItems) + (spacing * Math.max(0, totalItems - 1));

            this._mainContainer.set_style(`
                min-width: ${containerWidth}px;
                padding: 0 ${spacing}px;
            `);

            this._pinnedIconsBox.destroy_all_children();

            pinnedApps.forEach(appId => {
                const app = Gio.DesktopAppInfo.new(`${appId}.desktop`) || Gio.DesktopAppInfo.new(appId);
                if (app) {
                    this._addPinnedIcon(appId);
                } else if (appId.startsWith('link://')) {
                    this._addPinnedIcon(appId);
                }
            });

            this._pinnedSection.box.destroy_all_children();
            pinnedApps.forEach(appId => this._addMenuPinnedItem(appId));
        }

        _updateIconsSpacing() {
            const spacing = Math.min(20, Math.max(0, this._settings.get_int('spacing')));
            this._pinnedIconsBox.set_style(`spacing: ${spacing}px;`);
        }

        // 7. Gestione elementi pinnati
        _pinApp(app) {

            const current = this._settings.get_strv('pinned-apps');
            if (current.length >= 10) {
                this._showMaxItemsError();
                return;
            }

            const rawAppId = app.get_id();
            const appId = rawAppId.replace(/\.desktop$/i, '');

            if (!current.includes(appId)) {
                const updated = [...current, appId];
                this._settings.set_strv('pinned-apps', updated);
            }
        }

        _unpinApp(appId) {
            if (appId.startsWith('link://')) {
                const url = appId.replace('link://', '');
                const links = this._settings.get_strv('custom-links')
                    .filter(l => l !== url);
                this._settings.set_strv('custom-links', links);
            }

            const startupApps = this._settings.get_strv('startup-apps')
                .filter(id => id !== appId);
            this._settings.set_strv('startup-apps', startupApps);

            const pinnedApps = this._settings.get_strv('pinned-apps')
                .filter(id => id !== appId);
            this._settings.set_strv('pinned-apps', pinnedApps);
        }

        _isPinned(appId) {
            const cleanAppId = this._sanitizeAppId(appId);
            return this._settings.get_strv('pinned-apps').includes(cleanAppId);
        }

        // 8. Funzioni helper e utilità
        _isValidUrl(url) {
            try {
                new URL(url);
                return true;
            } catch {
                return url.startsWith('http') || url.startsWith('ftp');
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

        _handleWakeupEvent() {
            this._addTimeout(2000, () => {
                this._updateRunningIndicators();
                this._refreshUI();
                return GLib.SOURCE_REMOVE;
            });
        }

        _pinLink(url) {

            const pinnedApps = this._settings.get_strv('pinned-apps');
            if (pinnedApps.length >= 10) {
                this._showMaxItemsError();
                return;
            }

            if (!url) return;
            if (!url.includes('://')) url = `http://${url}`;

            const links = this._settings.get_strv('custom-links');

            if (!links.includes(url)) {
                const newLinks = [...links, url];
                const newPinnedApps = [...pinnedApps, `link://${url}`];

                this._settings.set_strv('custom-links', newLinks);
                this._settings.set_strv('pinned-apps', newPinnedApps);
                this._refreshUI();
            }
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

                if (this._settings.get_strv('pinned-apps').length >= 10) {
                    item.setSensitive(false);
                    item.label.text = _("Max items reached - unpin something first");
                }

                item.connect('activate', () => {
                    this._pinApp(app);

                    this._searchInput.set_text('');
                    this._updateSearch();

                    this.menu.close();

                });

                this._resultsSection.box.add_child(item);
            });

            this.menu.actor.show_all();
            this.menu.actor.queue_redraw();

        }

        _sanitizeAppId(appId) {
            const sanitized = appId
                .replace(/\.desktop$/i, '')
                .replace(/^application:\/\//i, '');
            return sanitized;
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

        _getIndicatorForApp(appId) {
            const iconBox = this._pinnedIconsBox.get_children().find(b => b.appId === appId);
            return iconBox ? iconBox.runningIndicator : null;
        }

        _forceImmediateUpdate(appId) {
            const indicator = this._getIndicatorForApp(appId);
            if (indicator) {
                indicator.visible = true;
                indicator.opacity = 0;
                indicator.set_scale(0.5, 0.5);
                indicator.ease({
                    opacity: 255,
                    scale_x: 1,
                    scale_y: 1,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            }
            this._updateRunningIndicators();
        }

        _shortenUrl(url) {
            try {
                const parsed = new URL(url);
                return parsed.hostname.replace(/^www\./i, '');
            } catch {
                return url.substring(0, 15) + '...';
            }
        }

        _forceFullRefresh() {
            this._runningTracker = new Set(
                this._appSystem.get_running().map(app => this._sanitizeAppId(app.get_id()))
            );

            this._pinnedIconsBox.get_children().forEach(iconBox => {
                this._updateRunningIndicator(iconBox.appId, iconBox.runningIndicator);
            });

            this._addTimeout(1000, () => {
                this._appSystem = Shell.AppSystem.get_default();
                this._updateRunningIndicators();
                return GLib.SOURCE_REMOVE;
            });
        }

        _findAppById(appId) {
            let app = this._appSystem.lookup_app(appId) ||
                this._appSystem.lookup_app(`${appId}.desktop`);

            if (!app) {
                const gioApp = Gio.DesktopAppInfo.new(`${appId}.desktop`) ||
                    Gio.DesktopAppInfo.new(appId);

                if (gioApp) {
                    app = this._appSystem.lookup_app(gioApp.get_id());
                }
            }

            return app;
        }

        _refreshUIWithEffect() {
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

            this._addTimeout(300, () => {
                this._settings.get_strv('pinned-apps').forEach(appId =>
                    this._addPinnedIcon(appId)
                );
                return GLib.SOURCE_REMOVE;
            });
        }

        _animateAndMoveToEnd(appId, iconBox) {
            const currentApps = this._settings.get_strv('pinned-apps');
            const currentIndex = currentApps.indexOf(appId);

            if (currentIndex === currentApps.length - 1) {
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

            iconBox.ease({
                scale_x: 1.2,
                scale_y: 1.2,
                opacity: 0,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    const updatedApps = this._settings.get_strv('pinned-apps');
                    const newIndex = updatedApps.indexOf(appId);

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

        _updateIndicatorColor(indicator) {
            const color = this._settings.get_string('indicator-color');
            indicator.set_style(`background-color: ${color};`);
        }

        _getUrlName(url) {
            try {
                if (!url.match(/^[a-zA-Z]+:\/\//)) {
                    url = 'http://' + url;
                }

                const parsed = new URL(url);
                let hostname = parsed.hostname;

                hostname = hostname.replace(/^www\./i, '');

                const specialCases = {
                    'youtube.com': 'YouTube',
                    'google.com': 'Google',
                    'github.com': 'GitHub',
                };

                return specialCases[hostname.toLowerCase()] ||
                    hostname.split('.')[0].charAt(0).toUpperCase() +
                    hostname.split('.')[0].slice(1);
            } catch (e) {
                return url.replace(/^https?:\/\//, '')
                    .replace(/^www\./i, '')
                    .split('/')[0];
            }
        }

        _getAppOrLinkName(appId) {
            if (appId.startsWith('link://')) {
                return this._getUrlName(appId.replace('link://', ''));
            } else {
                const app = Gio.DesktopAppInfo.new(`${appId}.desktop`) || Gio.DesktopAppInfo.new(appId);
                return app ? app.get_name() : appId;
            }
        }


        _addMenuPinnedItem(appId) {
            if (appId.startsWith('link://')) {
                const url = appId.replace('link://', '');
                const item = new PopupMenu.PopupMenuItem(url);

                const icon = new St.Icon({
                    icon_name: 'emblem-web-symbolic',
                    icon_size: this._settings.get_int('icon-size'),
                    style_class: 'app-pinner-link-icon'
                });
                item.insert_child_at_index(icon, 0);

                const spacer = new St.BoxLayout({ x_expand: true });
                item.actor.add_child(spacer);

                const removeBtn = new St.Button({
                    child: new St.Label({ text: '×' }),
                    style_class: 'app-pinner-remove-btn'
                });

                item.connect('activate', () => {
                    Gio.AppInfo.launch_default_for_uri(url, null);
                    this.menu.close();
                });

                removeBtn.connect('clicked', () => {
                    this._unpinApp(`link://${url}`);
                });

                item.add_child(removeBtn);
                this._pinnedSection.box.add_child(item);
            } else {
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

                const spacer = new St.BoxLayout({ x_expand: true });
                item.actor.add_child(spacer);

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
        }
    });

function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

export default class AppPinnerExtension extends Extension {

    constructor(metadata) {
        super(metadata);
        this._timeoutIds = new Set();
        this._settingsHandler = [];
    }

    _addTimeout(interval, callback) {
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            const result = callback();
            this._timeoutIds.delete(sourceId);
            return result;
        });
        this._timeoutIds.add(sourceId);
        return sourceId;
    }

    _dbusImpl = null;

    // 1. Lifecycle dell'estensione
    enable() {

        this._settingsHandler = [];

        this._settings = this.getSettings();

        this._validateSettings();

        this._settingsHandler.push(
            this._settings.connect('changed::show-in-panel', () => {
                if (this._indicator) {
                    this._indicator._updateVisibility();
                }
            })
        );

        this._sessionConnection = Gio.DBus.session;
        this._sessionWatcher = this._sessionConnection.watch_name(
            'org.gnome.Shell',
            Gio.BusNameWatcherFlags.NONE,
            () => { },
            () => this.disable()
        );

        const dbusInterface = `
        <node>
            <interface name="org.gnome.Shell.Extensions.AppPinner">
                <method name="LaunchPosition">
                    <arg type="u" name="position" direction="in"/>
                </method>
            </interface>
        </node>`;

        if (!this._dbusImpl) {
            try {
                this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(dbusInterface, this);
                this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/AppPinner');
            } catch (e) {
                console.error('Errore registrazione D-Bus:', e.message);
            }
        }

        if (!this._settings.settings_schema.get_key('show-in-panel')) {
            this._settings.set_boolean('show-in-panel', true);
        }

        this._positionHandler = this._settings.connect(
            'changed::position-in-panel',
            () => this._safeRecreateIndicator()
        );

        this._keybindings = [];
        for (let i = 1; i <= 10; i++) {
            const shortcut = this._settings.get_string(`shortcut-${i}`);
            if (shortcut) {
                this._addKeybinding(i);
            }
        }

        this._shortcutHandlers = [];
        for (let i = 1; i <= 10; i++) {
            const handlerId = this._settings.connect(`changed::shortcut-${i}`, () => this._updateKeybinding(i));
            this._shortcutHandlers.push(handlerId);
        }

        this._safeRecreateIndicator();

        this._settings.connect('changed::startup-apps', () => this._syncAutostart());
        this._syncAutostart();

        this._startupChangedId = this._settings.connect(
            'changed::startup-apps',
            () => {
                this._addTimeout(500, () => {
                    console.log("[DEBUG] Startup apps changed!");
                    this._syncAutostart();
                    return GLib.SOURCE_REMOVE;
                });
            }
        );

        this._settings.connect('changed::pinned-apps', () => {
            this._cleanOrphanedStartupApps();
            this._syncAutostart();
        });

        this._settings.connect('changed::startup-apps', () => this._syncAutostart());

        this._cleanOrphanedStartupApps();
        this._syncAutostart();

        this._settings.connect('changed::pinned-apps', () => {
            this._cleanOrphanedStartupApps();
            this._syncAutostart();
        });

        this._addTimeout(2000, () => {
            this._syncAutostart();
            return GLib.SOURCE_REMOVE;
        });

        this._indicator._checkVisibility();

    }

    disable() {

        if (this._sessionWatcherId) {
            this._sessionConnection.unwatch_name(this._sessionWatcherId);
            this._sessionWatcherId = null;
        }

        if (this._dbusImpl) {
            try {
                this._dbusImpl.unexport();
            } catch (e) {
                console.error('DBus unexport error:', e);
            }
            this._dbusImpl = null;
        }


        for (let i = 1; i <= 10; i++) {
            this._removeKeybinding(i);
        }

        const mediaKeysSettings = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys'
        });

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
            const parent = this._indicator.get_parent();
            if (parent) {
                parent.remove_child(this._indicator);
            }
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._timeoutIds) {
            this._timeoutIds.forEach(id => GLib.Source.remove(id));
            this._timeoutIds.clear();
        }

        this._settings.disconnect(this._shortcutHandler);

        const autostartDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'autostart']);
        const dir = Gio.File.new_for_path(autostartDir);

        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let fileInfo;
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            const name = fileInfo.get_name();
            if (name.startsWith('app-pinner-')) {
                GLib.unlink(`${autostartDir}/${name}`);
            }
        }

        if (this._startupChangedId) {
            this._settings.disconnect(this._startupChangedId);
        }

        try {
            const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let fileInfo;
            while ((fileInfo = enumerator.next_file(null)) !== null) {
                const name = fileInfo.get_name();
                if (name.startsWith('app-pinner-')) {
                    GLib.unlink(`${autostartDir}/${name}`);
                }
            }
        } catch (e) {
            console.error('Errore pulizia autostart:', e);
        }

        if (this._settingsHandler) {
            this._settingsHandler.forEach(handler => {
                if (handler) {
                    this._settings.disconnect(handler);
                }
            });
            this._settingsHandler = null;
        }

        if (this._indicator && this._indicator._checkVisibility) {
            GLib.Source.remove(this._indicator._checkVisibilityTimeout);
        }

        this._settings = null
    }

    _updateKeybinding(position) {
        const shortcut = this._settings.get_string(`shortcut-${position}`);
        if (shortcut) {
            this._addKeybinding(position);
        } else {
            this._removeKeybinding(position);
        }
    }

    // 2. Gestione D-Bus e keybindings
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

    LaunchPosition(position) {
        this._launchAppByPosition(position);
    }

    _launchAppByPosition(position) {

        const apps = this._settings.get_strv('pinned-apps');

        if (apps.length === 0) return;

        const index = position - 1;
        if (index < 0 || index >= apps.length) return;

        const appId = apps[index];

        if (appId.startsWith('link://')) {
            if (!this._indicator) return;

            this._indicator._launchApp(appId);
            return;
        }

        const appSys = Shell.AppSystem.get_default();
        let app = appSys.lookup_app(`${appId}.desktop`) || appSys.lookup_app(appId);

        if (!app) {
            const gioApp = Gio.DesktopAppInfo.new(`${appId}.desktop`) || Gio.DesktopAppInfo.new(appId);

            if (!gioApp) {
                console.error(`[ERROR] App ${appId} non trovata in nessun formato`);
                return;
            }
        } else {
        }

        this._indicator._launchApp(appId);
    }

    // 3. Gestione autostart
    _syncAutostart() {
        const autostartDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'autostart']);
        const startupApps = this._settings.get_strv('startup-apps');

        if (!GLib.file_test(autostartDir, GLib.FileTest.IS_DIR)) {
            GLib.mkdir_with_parents(autostartDir, 0o755);
        }

        const validFiles = new Map();

        startupApps.forEach(entry => {
            if (entry.startsWith('link://')) {
                const url = entry.replace('link://', '');
                const sanitized = this._sanitizeForFilename(url);
                const fileName = `app-pinner-link-${sanitized}.desktop`;
                validFiles.set(fileName, true);

                const content = [
                    '[Desktop Entry]',
                    'Type=Application',
                    `Name=Link ${url}`,
                    `Exec=xdg-open "${url}"`,
                    'Icon=emblem-web-symbolic',
                    'X-GNOME-Autostart-enabled=true',
                    'X-GNOME-Autostart-Delay=2',
                    'NoDisplay=false',
                    ''
                ].join('\n');

                try {
                    GLib.file_set_contents(`${autostartDir}/${fileName}`, content);
                    GLib.chmod(`${autostartDir}/${fileName}`, 0o644);
                } catch (e) {
                    console.error(`Errore scrittura link ${url}:`, e.message);
                }
            } else {
                const appInfo = this._getAppInfo(entry);
                if (!appInfo) {
                    console.error(`[ERROR] App non trovata: ${entry}`);
                    return;
                }

                const desktopId = appInfo.get_id() || `${entry}.desktop`;
                const sanitizedId = this._sanitizeForFilename(desktopId);
                const fileName = `app-pinner-${sanitizedId}.desktop`;
                validFiles.set(fileName, true);

                const execCommand = appInfo.get_string('Exec');
                if (!execCommand) {
                    console.error(`[ERROR] Comando non trovato per ${entry}`);
                    return;
                }

                const desktopContent = [
                    '[Desktop Entry]',
                    'Type=Application',
                    `Name=${appInfo.get_name()} (App Pinner)`,
                    `Exec=${execCommand}`,
                    'X-GNOME-Autostart-enabled=true',
                    'X-GNOME-Autostart-Delay=2',
                    'Icon=' + (appInfo.get_icon() || ''),
                    'Comment=Avviato automaticamente da App Pinner',
                    'NoDisplay=false',
                    ''
                ].join('\n');

                try {
                    GLib.file_set_contents(`${autostartDir}/${fileName}`, desktopContent);
                    GLib.chmod(`${autostartDir}/${fileName}`, 0o644);
                } catch (e) {
                    console.error(`Errore scrittura app ${entry}:`, e.message);
                }
            }
        });

        const dir = Gio.File.new_for_path(autostartDir);
        try {
            const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let fileInfo;
            while ((fileInfo = enumerator.next_file(null))) {
                const fileName = fileInfo.get_name();
                if (fileName.startsWith('app-pinner-') && !validFiles.has(fileName)) {
                    GLib.unlink(`${autostartDir}/${fileName}`);
                }
            }
        } catch (e) {
            console.error('Errore durante la pulizia dei file:', e.message);
        }
    }

    // 4. Funzioni helper e validazione
    _validateSettings() {
        const currentPos = this._settings.get_string('position-in-panel');
        if (!['left', 'right'].includes(currentPos)) {
            this._settings.set_string('position-in-panel', 'right');
        }
    }

    _getAppInfo(appId) {
        console.log(`[DEBUG] Getting app info for: ${appId}`);

        const appSys = Shell.AppSystem.get_default();
        const allApps = appSys.get_installed();
        const foundApp = allApps.find(app =>
            app.get_id().toLowerCase() === appId.toLowerCase()
        );

        if (foundApp) {
            return Gio.DesktopAppInfo.new(foundApp.get_id());
        }

        const flatpakPaths = [
            '/var/lib/flatpak/exports/share/applications/',
            `${GLib.get_home_dir()}/.local/share/flatpak/exports/share/applications/`
        ];

        for (const path of flatpakPaths) {
            const fullPath = `${path}${appId}.desktop`;
            if (GLib.file_test(fullPath, GLib.FileTest.EXISTS)) {
                return Gio.DesktopAppInfo.new_from_filename(fullPath);
            }
        }

        const dataDirs = GLib.get_system_data_dirs();
        for (const dataDir of dataDirs) {
            const appPath = `${dataDir}/applications/${appId}.desktop`;
            if (GLib.file_test(appPath, GLib.FileTest.EXISTS)) {
                return Gio.DesktopAppInfo.new_from_filename(appPath);
            }
        }

        return null;
    }

    _sanitizeForFilename(appId) {
        return appId
            .replace(/\.desktop$/i, '')
            .replace(/[^a-zA-Z0-9-]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 50);
    }

    _cleanOrphanedStartupApps() {
        const pinnedApps = this._settings.get_strv('pinned-apps');
        const customLinks = this._settings.get_strv('custom-links');
        const startupApps = this._settings.get_strv('startup-apps');

        const validEntries = new Set([
            ...pinnedApps,
            ...customLinks.map(url => `link://${url}`)
        ]);

        const cleaned = startupApps.filter(appId =>
            validEntries.has(appId) ||
            customLinks.includes(appId.replace('link://', ''))
        );

        if (!arraysEqual(cleaned, startupApps)) {
            this._settings.set_strv('startup-apps', cleaned);
        }
    }

    _removeKeybinding(position) {
        const customPath = `/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/app-pinner-${position}/`;

        const mediaKeysSettings = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys'
        });

        const currentPaths = mediaKeysSettings.get_strv('custom-keybindings');
        if (currentPaths.includes(customPath)) {
            const newPaths = currentPaths.filter(p => p !== customPath);
            mediaKeysSettings.set_strv('custom-keybindings', newPaths);

            const customSettings = new Gio.Settings({
                schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
                path: customPath
            });
            customSettings.reset('name');
            customSettings.reset('command');
            customSettings.reset('binding');
        }
    }

    _showMaxItemsError() {
        Main.notifyError(
            _("Maximum items reached"),
            _("You can pin up to 10 items maximum")
        );
    }

    _validateAccelerator(accelerator) {
        if (!accelerator) return false;

        try {
            const [key, mods] = Clutter.accelerator_parse(accelerator);
            return key !== 0;
        } catch (e) {
            return false;
        }
    }

    _safeRecreateIndicator() {
        const iconSize = this._settings.get_int('icon-size');
        const spacing = this._settings.get_int('spacing');
        const labels = this._settings.get_boolean('enable-labels');

        this._recreateIndicator();

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

        if (this._indicator.get_parent()) {
            this._indicator.get_parent().remove_child(this._indicator);
        }

        switch (position) {
            case 'left':
                Main.panel._leftBox.insert_child_at_index(this._indicator, 0);
                break;

            case 'center':
                if (Main.panel._centerBox) {
                    Main.panel._centerBox.add_child(this._indicator);
                } else {
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

        this._indicator.set_style_class_name(
            `app-pinner-position-${position}`
        );

        Main.panel.queue_relayout();
        Main.panel.menuManager.addMenu(this._indicator.menu);
    }
}