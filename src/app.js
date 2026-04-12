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
        const speedProfile = NLS.ensureSpeedProfileOverlay();
        if (!main || !rel || !map || !settings || !settingsToggle || !manager || !speedProfile) return;

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
            if (speedProfile.parentElement !== player) player.appendChild(speedProfile);
        }
    }

    /**
     * Create or get FPS counter display
     */
    function ensureFpsCounter() {
        if (state.fpsCounter) return state.fpsCounter;

        const counter = document.createElement('div');
        counter.id = 'nls-fps-counter';
        counter.style.position = 'fixed';
        counter.style.bottom = '10px';
        counter.style.right = '10px';
        counter.style.fontSize = '11px';
        counter.style.fontFamily = 'monospace';
        counter.style.color = '#0f0';
        counter.style.background = 'rgba(0,0,0,0.7)';
        counter.style.padding = '4px 8px';
        counter.style.borderRadius = '3px';
        counter.style.zIndex = '99999';
        counter.style.pointerEvents = 'none';
        counter.textContent = 'FPS: --';
        
        document.body.appendChild(counter);
        state.fpsCounter = counter;
        return counter;
    }

    /**
     * Animation loop at 30fps to update car progress cache
     */
    function startAnimationLoop() {
        let lastFrameTime = 0;
        let frameCount = 0;
        let lastFpsUpdateTime = 0;
        const frameIntervalMs = 1000 / 30; // 30fps

        function animationFrame(nowMs) {
            if (nowMs - lastFrameTime >= frameIntervalMs) {
                NLS.updateAllCarProgress();
                lastFrameTime = nowMs;
                frameCount++;

                // Update FPS counter every 500ms
                if (nowMs - lastFpsUpdateTime >= 500) {
                    const fps = Math.round((frameCount * 1000) / (nowMs - lastFpsUpdateTime + 1));
                    const counter = ensureFpsCounter();
                    counter.textContent = `FPS: ${fps}`;
                    frameCount = 0;
                    lastFpsUpdateTime = nowMs;
                }
            }
            requestAnimationFrame(animationFrame);
        }

        requestAnimationFrame(animationFrame);
    }

    /**
     * Initialize overlays and start timers.
     */
    function start() {
        NLS.log('App start');
        tick();
        NLS.connect();
        startAnimationLoop();
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
