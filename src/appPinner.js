import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


import { arraysEqual, isValidUrl, sortApps, sanitizeAppId, matchQuery, fuzzyMatch, shortenUrl, getUrlName, getAppOrLinkName } from './utils.js';

export const AppPinner = GObject.registerClass(
    class AppPinner extends PanelMenu.Button {

        // 1. Costruttore e inizializzazione
        _init(settings) {
            super._init(0.0, _('App Pinner'));
            this.add_style_class_name('quicklaunch-panel-button');
            this._settings = settings;
            this._destroyed = false;
            this._pendingApps = new Set();
            this._settingsHandler = [];
            this._longPressTimeoutId = null;

            this._windowTracker = Shell.WindowTracker.get_default();
            this._windowTracker.connect('tracked-windows-changed', this._updateRunningIndicators.bind(this));

            this._settingsHandler.push(
                this._settings.connect('changed::show-in-panel', () => this._updateVisibility()),
                this._settings.connect('changed::sort-alphabetically', () => this._refreshUI()),
                this._settings.connect('changed::show-pin-icon', () => this._updatePinIconVisibility())
            );

            this._appSystem = Shell.AppSystem.get_default();
            this._runningTracker = new Set();
            this._appStateChangedId = this._appSystem.connect('app-state-changed',
                () => this._updateRunningIndicators());

            this._mainContainer = new St.BoxLayout({
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                track_hover: true
            });
            this.add_child(this._mainContainer);

            this._menuIconButton = new St.Button({
                style_class: 'quicklaunch-pin-button',
                reactive: true,
                can_focus: true,
                track_hover: true,
                child: new St.Icon({
                    icon_name: 'view-pin-symbolic',
                    style_class: 'system-status-icon app-pinner-menu-icon',
                    icon_size: 15
                })
            });
            this._menuIcon = this._menuIconButton.get_child();
            this._mainContainer.add_child(this._menuIconButton);

            this._pinnedIconsBox = new St.BoxLayout({
                style_class: 'app-pinner-icons',
                vertical: false
            });
            this._mainContainer.add_child(this._pinnedIconsBox);

            this._updateIconsSpacing();

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
                }
            });

            this._settingsHandler.push(
                this._settings.connect('changed::custom-links', () => this._refreshUI())
            );

            this._timeoutIds = new Set();

        }

        _updateVisibility() {
            const showInPanel = this._settings.get_boolean('show-in-panel');
            this._pinnedIconsBox.visible = showInPanel;
            this._updatePinIconVisibility();
            this._pinnedIconsBox.queue_relayout();
            this.queue_relayout();
        }

        _updatePinIconVisibility() {
            const showPinIcon = this._settings.get_boolean('show-pin-icon');
            const hasPinnedApps = this._settings.get_strv('pinned-apps').length > 0;
            const noPinnedApps = !hasPinnedApps;

            const iconSize = noPinnedApps ? 18 : 18;
            this._menuIcon.icon_size = iconSize;

            this._menuIcon.opacity = (noPinnedApps || showPinIcon) ? 255 : 0;
            this._menuIcon.reactive = (noPinnedApps || showPinIcon);
            this._menuIcon.set_width(showPinIcon ? -1 : iconSize);

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

        vfunc_event(event) {
            if (event.type() === Clutter.EventType.BUTTON_PRESS ||
                event.type() === Clutter.EventType.TOUCH_BEGIN) {
                const target = event.get_source();
                if (this._pinnedIconsBox && this._pinnedIconsBox.contains(target)) {
                    return Clutter.EVENT_PROPAGATE;
                }
                if (this.menu)
                    this.menu.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        // 2. Metodi lifecycle e gestione stato
        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;

            if (this._logindId && this._logindProxy) {
                this._logindProxy.disconnectSignal(this._logindId);
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

            const searchEntry = new PopupMenu.PopupBaseMenuItem();
            const searchBox = new St.BoxLayout({
                vertical: false,
                style_class: 'search-box',
                x_expand: false,
                x_align: Clutter.ActorAlign.FILL
            });

            this._searchInput = new St.Entry({
                hint_text: _('Search applications...'),
                style_class: 'app-pinner-search-entry',
                can_focus: true,
                x_expand: true
            });

            searchBox.add_child(this._searchInput);
            searchEntry.actor.add_child(searchBox);
            this.menu.addMenuItem(searchEntry);

            this._resultsSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._resultsSection);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._pinnedSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._pinnedSection);

            this._searchInput.clutter_text.connect('text-changed', () => this._updateSearch());

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const linkSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(linkSection);

            const linkBox = new St.BoxLayout({
                vertical: false,
                style_class: 'app-pinner-link-box',
                x_expand: false,
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
                if (isValidUrl(url)) {
                    this._pinLink(url);
                    this._linkInput.set_text('');
                    this.menu.close();
                }
            });

            linkBox.add_child(this._linkInput);
            linkBox.add_child(addLinkBtn);
            linkSection.actor.add_child(linkBox);

            this._mainContainer.reactive = true;
            this._mainContainer.connect('button-press-event', (actor, event) => {
                if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                    const target = event.get_source();
                            if (this._pinnedIconsBox.contains(target)) {
                        return Clutter.EVENT_PROPAGATE;
                    }
                    this.menu.toggle();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            this.menu.actor.connect('button-press-event', (actor, event) => {
                const target = event.get_source();
                if (!this.menu.actor.contains(target)) {
                    this.menu.close();
                }
            });
        }

        _addPinnedIcon(appId) {

            if (appId.startsWith('link://')) {
                const url = appId.replace('link://', '');
                return this._addLinkIcon(url);
            }


            let app = Gio.DesktopAppInfo.new(`${appId}.desktop`) ||
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
                y_align: Clutter.ActorAlign.CENTER
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
                    longPressTimeoutId = null;
                }

                pressStartTime = Date.now();
                isLongPress = false;

                longPressTimeoutId = this._addTimeout(500, () => {
                    isLongPress = true;
                    this._animateAndMoveToEnd(appId, iconBox);
                    longPressTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });

                actor.ease({
                    scale_x: 0.8,
                    scale_y: 0.8,
                    duration: 200
                });
                return Clutter.EVENT_STOP;
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

                if (!isLongPress) {
                    this._launchApp(appId);
                }
                isLongPress = false;
                return Clutter.EVENT_STOP;
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


            let pressStartTime = 0;
            let longPressTimeoutId = null;
            let isLongPress = false;

            iconButton.connect('button-press-event', (actor, event) => {

                pressStartTime = Date.now();
                isLongPress = false;

                longPressTimeoutId = this._addTimeout(500, () => {
                    isLongPress = true;
                    this._animateAndMoveToEnd(appId, iconBox);
                    longPressTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });

                actor.ease({
                    scale_x: 0.8,
                    scale_y: 0.8,
                    duration: 200
                });

                return Clutter.EVENT_STOP;
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

                if (!isLongPress) {
                    Gio.AppInfo.launch_default_for_uri(url, null);
                }
                isLongPress = false;
                return Clutter.EVENT_STOP;
            });

            const container = new St.Bin();
            container.add_child(iconButton);
            iconBox.add_child(container);

            if (showLabels) {
                const label = new St.Label({
                    text: shortenUrl(url),
                    style_class: 'app-pinner-label',
                    x_align: Clutter.ActorAlign.CENTER
                });
                iconBox.add_child(label);
            }

            iconBox.appId = appId;
            this._pinnedIconsBox.add_child(iconBox);

            return iconBox;
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
                    const nameA = getAppOrLinkName(a).toLowerCase();
                    const nameB = getAppOrLinkName(b).toLowerCase();
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

            this._updatePinIconVisibility();
        }

    

    _showMaxItemsError() {
        Main.notifyError(
            _("Maximum items reached"),
            _("You can pin up to 10 items maximum")
        );
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
            const cleanAppId = sanitizeAppId(appId);
            return this._settings.get_strv('pinned-apps').includes(cleanAppId);
        }

        // 8. Funzioni helper e utilità


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

        _updateSearch() {
            this._resultsSection.box.destroy_all_children();
            const query = this._searchInput.get_text().trim().toLowerCase();
            if (!query) return;

            const iconSize = this._settings.get_int('icon-size');
            const appSys = Shell.AppSystem.get_default();

            const results = appSys.get_installed()
                .filter(app => {
                    const appId = sanitizeAppId(app.get_id());
                    return !this._isPinned(appId) &&
                        matchQuery(query, app.get_name().toLowerCase());
                })
                .sort((a, b) => sortApps(a, b, query))
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


        _forceFullRefresh() {
            this._runningTracker = new Set(
                this._appSystem.get_running().map(app => sanitizeAppId(app.get_id()))
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




        _addMenuPinnedItem(appId) {
            if (appId.startsWith('link://')) {
                const url = appId.replace('link://', '');
                const urlName = getUrlName(url);
                const item = new PopupMenu.PopupMenuItem(urlName);

                const icon = new St.Icon({
                    icon_name: 'emblem-web-symbolic',
                    icon_size: this._settings.get_int('icon-size'),
                    style_class: 'app-pinner-link-icon'
                });
                item.insert_child_at_index(icon, 0);

                const spacer = new St.BoxLayout({ x_expand: true });
                item.actor.add_child(spacer);

                const removeBtn = new St.Button({
                    child: new St.Icon({
                        icon_name: 'window-close-symbolic',
                        icon_size: 16
                    }),
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
                    child: new St.Icon({
                        icon_name: 'window-close-symbolic',
                        icon_size: 16
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

