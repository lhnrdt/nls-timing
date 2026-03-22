(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;

    function updateVisibility() {
        const main = NLS.ensureMainOverlay();
        const rel = NLS.ensureRelativeOverlay();
        const map = NLS.ensureTrackMap();
        const settings = NLS.ensureSettingsOverlay();
        const settingsToggle = NLS.ensureSettingsToggle();
        const show = NLS.matches();

        if (main) main.style.display = show ? 'block' : 'none';
        if (rel) rel.style.display = show ? 'block' : 'none';
        if (map) map.style.display = show ? 'block' : 'none';
        if (settings) settings.style.display = show && state.settingsOpen ? 'block' : 'none';
        if (settingsToggle) settingsToggle.style.display = show ? 'block' : 'none';
    }

    function tick() {
        const main = NLS.ensureMainOverlay();
        const rel = NLS.ensureRelativeOverlay();
        const map = NLS.ensureTrackMap();
        const settings = NLS.ensureSettingsOverlay();
        const settingsToggle = NLS.ensureSettingsToggle();
        if (!main || !rel || !map || !settings || !settingsToggle) return;

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
        }
    }

    function start() {
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
