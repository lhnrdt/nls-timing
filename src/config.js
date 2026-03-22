// Centralized IDs and configuration values shared across modules.
(() => {
    const NLS = window.NLS || (window.NLS = {});

    NLS.IDS = {
        MAIN_BOX_ID: 'yt-nls-main-box-20260321',
        REL_BOX_ID: 'yt-nls-rel-box-20260321',
        MAP_BOX_ID: 'yt-nls-track-map-20260321',
        SETTINGS_BOX_ID: 'yt-nls-settings-box-20260321',
        SETTINGS_TOGGLE_ID: 'yt-nls-settings-toggle-20260321'
    };

    NLS.MATCH = {
        channel: 'Nürburgring',
        titleContains: 'ADAC RAVENOL Nürburgring Langstrecken-Serie'
    };

    NLS.CONFIG = {
        wsUrl: 'wss://livetiming.azurewebsites.net/',
        eventId: '20',
        eventPid: [0, 4],
        maxRows: 10,
        relativeRowsBefore: 3,
        relativeRowsAfter: 3,
        relativeUpdateMs: 250,
        defaultStartNumber: '911',
        defaultDelayMs: 4000,
        defaultDotSize: 5,
        trackMapUrl: 'https://raw.githubusercontent.com/lhnrdt/nls-timing/modularization/trackmap.svg'
    };
})();
