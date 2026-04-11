// Shared runtime state for overlays and socket data.
(() => {
    const NLS = window.NLS || (window.NLS = {});
    const CONFIG = NLS.CONFIG;

    NLS.state = {
        ws: null,
        cars: [],
        latestPayload: null,
        payloadReceivedAtMs: null,
        carProgress: new Map(), // Cache of computed progress: STNR -> {progress, lapDistance, speedMps, etc}
        timeOffsetMs: 0,
        carKinematics: new Map(),
        leaderLap: null,

        mainTbody: null,
        mainStatus: null,
        mainMeta: null,

        relTbody: null,
        relStatus: null,
        relEstimateStatus: null,
        relEstimateCompleted: false,
        relInput: null,

        timingInit: new Map(),
        timingUpdated: new Set(),

        mapBox: null,
        mapSvg: null,
        mapTrackPath: null,
        mapDots: null,
        mapMarkers: null,
        mapSvgData: null,
        mapSvgLoading: false,

        settingsBox: null,
        settingsToggle: null,
        settingsOpen: false,
        delayMs: CONFIG.defaultDelayMs,
        dotSize: CONFIG.defaultDotSize,

        initialSelectionDone: false,
        selectedStartNumber: CONFIG.defaultStartNumber
    };
})();
