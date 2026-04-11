// Entry point that wires overlays, timers, and the websocket.
(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;

    /**
     * Toggle overlay visibility based on page match state.
     */
    function updateVisibility() {
        const main = NLS.ensureMainOverlay();
        const rel = NLS.ensureRelativeOverlay();
        const map = NLS.ensureTrackMap();
        const settings = NLS.ensureSettingsOverlay();
        const settingsToggle = NLS.ensureSettingsToggle();
        const show = NLS.matches();

        // Check hidden state from localStorage
        const mainHidden = localStorage.getItem('nls_main_leaderboard_hidden') === 'true';
        const relHidden = localStorage.getItem('nls_relative_timing_hidden') === 'true';
        const mapHidden = localStorage.getItem('nls_track_map_hidden') === 'true';
        const settingsHidden = localStorage.getItem('nls_settings_panel_hidden') === 'true';

        if (main) main.style.display = (show && !mainHidden) ? 'flex' : 'none';
        if (rel) rel.style.display = (show && !relHidden) ? 'block' : 'none';
        if (map) map.style.display = (show && !mapHidden) ? 'flex' : 'none';
        if (settings) settings.style.display = (show && state.settingsOpen && !settingsHidden) ? 'flex' : 'none';
        if (settingsToggle) settingsToggle.style.display = show ? 'block' : 'none';
    }

    /**
     * Periodic layout upkeep to keep overlays attached to the player.
     */
    function tick() {
        const main = NLS.ensureMainOverlay();
        const rel = NLS.ensureRelativeOverlay();
        const map = NLS.ensureTrackMap();
        const settings = NLS.ensureSettingsOverlay();
        const settingsToggle = NLS.ensureSettingsToggle();
        const manager = NLS.ensureOverlayManager();
        if (!main || !rel || !map || !settings || !settingsToggle || !manager) return;

        updateVisibility();

        if (state.mainMeta) {
            state.mainMeta.textContent = `${NLS.getChannel()} | ${NLS.getTitle()}`;
        }

        const player = NLS.getPlayerContainer();
        if (player) {
            const style = window.getComputedStyle(player);
            if (style.position === 'static') {
                player.style.position = 'relative';
            }

            if (main.parentElement !== player) player.appendChild(main);
            if (rel.parentElement !== player) player.appendChild(rel);
            if (map.parentElement !== player) player.appendChild(map);
            if (settings.parentElement !== player) player.appendChild(settings);
            if (settingsToggle.parentElement !== player) player.appendChild(settingsToggle);
            if (manager.parentElement !== player) player.appendChild(manager);
        }
    }

    /**
     * Initialize overlays and start timers.
     */
    function start() {
        NLS.log('App start');
        tick();
        NLS.connect();
        setInterval(tick, 1000);
        setInterval(() => {
            if (!state.latestPayload) return;
            NLS.renderRelative();
            NLS.renderTrackMap();
        }, NLS.CONFIG.relativeUpdateMs);
    }

    if (window.top !== window.self || location.pathname.includes('/live_chat')) {
        return;
    }

    start();
})();
