(() => {
    const NLS = window.NLS || (window.NLS = {});

    const STORAGE_PREFIX = 'nls_timing_';
    const KEYS = {
        WINDOW_POSITIONS: 'window_positions',
        CAR_SECTOR_TIMES: 'car_sector_times',
        SETTINGS: 'settings'
    };

    /**
     * Get a storage key with prefix.
     * @param {string} key
     * @returns {string}
     */
    function getStorageKey(key) {
        return STORAGE_PREFIX + key;
    }

    /**
     * Save window position and size.
     * @param {string} windowId
     * @param {{top: number, left: number, width: number, height: number}} rect
     */
    function saveWindowRect(windowId, rect) {
        try {
            const positions = JSON.parse(localStorage.getItem(getStorageKey(KEYS.WINDOW_POSITIONS)) || '{}');
            positions[windowId] = {
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            };
            localStorage.setItem(getStorageKey(KEYS.WINDOW_POSITIONS), JSON.stringify(positions));
        } catch (e) {
            console.warn('Failed to save window rect:', e);
        }
    }

    /**
     * Load window position and size.
     * @param {string} windowId
     * @returns {{top: number, left: number, width: number, height: number} | null}
     */
    function loadWindowRect(windowId) {
        try {
            const positions = JSON.parse(localStorage.getItem(getStorageKey(KEYS.WINDOW_POSITIONS)) || '{}');
            return positions[windowId] || null;
        } catch (e) {
            console.warn('Failed to load window rect:', e);
            return null;
        }
    }

    /**
     * Save sector times for a car (normalized by start number).
     * @param {string} startNumber
     * @param {string} sectorKey S1TIME, S2TIME, etc
     * @param {number} timeMs
     */
    function saveSectorTime(startNumber, sectorKey, timeMs) {
        try {
            if (!Number.isFinite(timeMs) || timeMs <= 0) return;

            const normalized = NLS.normalizeText(startNumber);
            const db = JSON.parse(localStorage.getItem(getStorageKey(KEYS.CAR_SECTOR_TIMES)) || '{}');

            if (!db[normalized]) {
                db[normalized] = {};
            }

            db[normalized][sectorKey] = Math.round(timeMs);
            localStorage.setItem(getStorageKey(KEYS.CAR_SECTOR_TIMES), JSON.stringify(db));
        } catch (e) {
            console.warn('Failed to save sector time:', e);
        }
    }

    /**
     * Load sector time for a car.
     * @param {string} startNumber
     * @param {string} sectorKey S1TIME, S2TIME, etc
     * @returns {number | null}
     */
    function loadSectorTime(startNumber, sectorKey) {
        try {
            const normalized = NLS.normalizeText(startNumber);
            const db = JSON.parse(localStorage.getItem(getStorageKey(KEYS.CAR_SECTOR_TIMES)) || '{}');
            return db[normalized]?.[sectorKey] || null;
        } catch (e) {
            console.warn('Failed to load sector time:', e);
            return null;
        }
    }

    /**
     * Get all cached sector times for a car.
     * @param {string} startNumber
     * @returns {Record<string, number> | null}
     */
    function loadAllSectorTimes(startNumber) {
        try {
            const normalized = NLS.normalizeText(startNumber);
            const db = JSON.parse(localStorage.getItem(getStorageKey(KEYS.CAR_SECTOR_TIMES)) || '{}');
            return db[normalized] || null;
        } catch (e) {
            console.warn('Failed to load all sector times:', e);
            return null;
        }
    }

    /**
     * Clear all cached sector times.
     */
    function clearSectorTimesCache() {
        try {
            localStorage.removeItem(getStorageKey(KEYS.CAR_SECTOR_TIMES));
        } catch (e) {
            console.warn('Failed to clear sector times cache:', e);
        }
    }

    /**
     * Save a setting value.
     * @param {string} key
     * @param {unknown} value
     */
    function saveSetting(key, value) {
        try {
            const settings = JSON.parse(localStorage.getItem(getStorageKey(KEYS.SETTINGS)) || '{}');
            settings[key] = value;
            localStorage.setItem(getStorageKey(KEYS.SETTINGS), JSON.stringify(settings));
        } catch (e) {
            console.warn('Failed to save setting:', e);
        }
    }

    /**
     * Load a setting value.
     * @param {string} key
     * @param {unknown} defaultValue
     * @returns {unknown}
     */
    function loadSetting(key, defaultValue) {
        try {
            const settings = JSON.parse(localStorage.getItem(getStorageKey(KEYS.SETTINGS)) || '{}');
            return settings[key] !== undefined ? settings[key] : defaultValue;
        } catch (e) {
            console.warn('Failed to load setting:', e);
            return defaultValue;
        }
    }

    /**
     * Get storage stats (for debugging/UI).
     * @returns {{windowCount: number, carCount: number, cacheSize: string}}
     */
    function getStats() {
        try {
            const positions = JSON.parse(localStorage.getItem(getStorageKey(KEYS.WINDOW_POSITIONS)) || '{}');
            const db = JSON.parse(localStorage.getItem(getStorageKey(KEYS.CAR_SECTOR_TIMES)) || '{}');

            let totalSize = 0;
            for (const key in localStorage) {
                if (key.startsWith(STORAGE_PREFIX)) {
                    totalSize += localStorage[key].length;
                }
            }

            const carCount = Object.keys(db).length;
            let sectorCount = 0;
            for (const car in db) {
                sectorCount += Object.keys(db[car]).length;
            }

            return {
                windowCount: Object.keys(positions).length,
                carCount,
                sectorCount,
                cacheSize: (totalSize / 1024).toFixed(2) + ' KB'
            };
        } catch (e) {
            console.warn('Failed to get storage stats:', e);
            return { windowCount: 0, carCount: 0, sectorCount: 0, cacheSize: '0 KB' };
        }
    }

    NLS.storage = {
        saveWindowRect,
        loadWindowRect,
        saveSectorTime,
        loadSectorTime,
        loadAllSectorTimes,
        clearSectorTimesCache,
        saveSetting,
        loadSetting,
        getStats
    };
})();
