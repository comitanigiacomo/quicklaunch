import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


import { AppPinner } from './appPinner.js';
import { arraysEqual, sanitizeForFilename } from './utils.js';

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
            }),
            this._settings.connect('changed::show-pin-icon', () => {
                if (this._indicator) {
                    this._indicator._updatePinIconVisibility();
                }
            })
        );

        this._sessionConnection = Gio.DBus.session;
        this._sessionWatcherId = this._sessionConnection.watch_name(
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

        this._settingsHandler.push(
            this._settings.connect('changed::startup-apps', () => this._syncAutostart()),
            this._settings.connect('changed::pinned-apps', () => {
                this._cleanOrphanedStartupApps();
                this._syncAutostart();
            })
        );

        this._cleanOrphanedStartupApps();
        this._syncAutostart();


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

        if (this._shortcutHandlers) {
            this._shortcutHandlers.forEach(id => this._settings.disconnect(id));
            this._shortcutHandlers = null;
        }

        if (this._settingsHandler) {
            this._settingsHandler.forEach(handler => {
                if (handler) this._settings.disconnect(handler);
            });
            this._settingsHandler = null;
        }

        this._settings = null;
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
                const sanitized = sanitizeForFilename(url);
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
                }
            } else {
                const appInfo = this._getAppInfo(entry);
                if (!appInfo) {
                    return;
                }

                const desktopId = appInfo.get_id() || `${entry}.desktop`;
                const sanitizedId = sanitizeForFilename(desktopId);
                const fileName = `app-pinner-${sanitizedId}.desktop`;
                validFiles.set(fileName, true);

                const execCommand = appInfo.get_string('Exec');
                if (!execCommand) {
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
        }
    }

    // 4. Funzioni helper e validazione
    _validateSettings() {
        const currentPos = this._settings.get_string('position-in-panel');
        if (!['left', 'center', 'right'].includes(currentPos)) {
            this._settings.set_string('position-in-panel', 'right');
        }
    }

    _getAppInfo(appId) {

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