import Gio from 'gi://Gio';

export function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}


export function isValidUrl(url) {
            try {
                new URL(url);
                return true;
            } catch {
                return url.startsWith('http') || url.startsWith('ftp');
            }
        }

export function sortApps(a, b, query) {
            const aName = a.get_name().toLowerCase();
            const bName = b.get_name().toLowerCase();

            if (aName === query) return -1;
            if (bName === query) return 1;

            const aStart = aName.startsWith(query);
            const bStart = bName.startsWith(query);
            if (aStart !== bStart) return aStart ? -1 : 1;

            return aName.length - bName.length;
        }

export function sanitizeAppId(appId) {
            const sanitized = appId
                .replace(/\.desktop$/i, '')
                .replace(/^application:\/\//i, '');
            return sanitized;
        }

export function matchQuery(query, appName) {
            const keywords = appName.split(/[\s-]/);
            return appName.includes(query) ||
                keywords.some(k => k.startsWith(query)) ||
                fuzzyMatch(query, appName);
        }

export function fuzzyMatch(pattern, str) {
            let patternIndex = 0;
            for (const char of str.toLowerCase()) {
                if (char === pattern[patternIndex]) {
                    if (++patternIndex === pattern.length) return true;
                }
            }
            return false;
        }

export function shortenUrl(url) {
            return getUrlName(url);
        }

export function getUrlName(url) {
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

export function getAppOrLinkName(appId) {
            if (appId.startsWith('link://')) {
                return getUrlName(appId.replace('link://', ''));
            } else {
                const app = Gio.DesktopAppInfo.new(`${appId}.desktop`) || Gio.DesktopAppInfo.new(appId);
                return app ? app.get_name() : appId;
            }
        }

export function sanitizeForFilename(appId) {
        return appId
            .replace(/\.desktop$/i, '')
            .replace(/[^a-zA-Z0-9-]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 50);
    }
