(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { SETTINGS_BOX_ID, SETTINGS_TOGGLE_ID } = NLS.IDS;

    /**
     * Ensure the settings toggle button exists and is attached.
     * @returns {HTMLButtonElement|null}
     */
    function ensureSettingsToggle() {
        let button = document.getElementById(SETTINGS_TOGGLE_ID);
        const player = NLS.getPlayerContainer();
        if (!player) return button || null;

        if (button) {
            if (button.parentElement !== player) player.appendChild(button);
            return button;
        }

        const style = window.getComputedStyle(player);
        if (style.position === 'static') {
            player.style.position = 'relative';
        }

        button = document.createElement('button');
        button.id = SETTINGS_TOGGLE_ID;
        button.type = 'button';
        button.textContent = 'Settings';
        button.style.position = 'absolute';
        button.style.top = '10px';
        button.style.right = '460px';
        button.style.zIndex = '9999';
        button.style.background = 'rgba(0,0,0,0.72)';
        button.style.color = '#fff';
        button.style.border = '1px solid rgba(255,255,255,0.2)';
        button.style.borderRadius = '6px';
        button.style.padding = '4px 8px';
        button.style.fontFamily = 'Arial, sans-serif';
        button.style.fontSize = '11px';
        button.style.cursor = 'pointer';
        button.style.pointerEvents = 'auto';

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            state.settingsOpen = !state.settingsOpen;
            const panel = document.getElementById(SETTINGS_BOX_ID);
            if (panel) panel.style.display = state.settingsOpen ? 'block' : 'none';
        });

        player.appendChild(button);
        state.settingsToggle = button;

        return button;
    }

    /**
     * Ensure the settings panel exists and is attached.
     * @returns {HTMLDivElement|null}
     */
    function ensureSettingsOverlay() {
        let box = document.getElementById(SETTINGS_BOX_ID);
        const player = NLS.getPlayerContainer();
        if (!player) return box || null;

        if (box) {
            if (box.parentElement !== player) player.appendChild(box);
            return box;
        }

        const style = window.getComputedStyle(player);
        if (style.position === 'static') {
            player.style.position = 'relative';
        }

        box = document.createElement('div');
        box.id = SETTINGS_BOX_ID;
        box.style.position = 'absolute';
        box.style.top = '42px';
        box.style.right = '460px';
        box.style.zIndex = '9999';
        box.style.background = 'rgba(0,0,0,0.72)';
        box.style.color = '#fff';
        box.style.padding = '6px 8px';
        box.style.borderRadius = '6px';
        box.style.fontFamily = 'Arial, sans-serif';
        box.style.fontSize = '11px';
        box.style.pointerEvents = 'auto';
        box.style.boxSizing = 'border-box';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';

        const header = document.createElement('div');
        header.style.fontWeight = 'bold';
        header.style.marginBottom = '6px';
        header.textContent = 'Settings';

        const delayRow = document.createElement('div');
        delayRow.style.display = 'flex';
        delayRow.style.alignItems = 'center';
        delayRow.style.gap = '6px';
        delayRow.style.marginBottom = '6px';

        const delayLabel = document.createElement('span');
        delayLabel.textContent = 'Delay (s)';

        const delayInput = document.createElement('input');
        delayInput.type = 'number';
        delayInput.min = '0';
        delayInput.step = '0.5';
        delayInput.value = (state.delayMs / 1000).toFixed(1);
        delayInput.style.width = '64px';
        delayInput.style.padding = '2px 4px';
        delayInput.style.fontSize = '11px';
        delayInput.style.border = '1px solid rgba(255,255,255,0.25)';
        delayInput.style.borderRadius = '4px';
        delayInput.style.background = 'rgba(255,255,255,0.08)';
        delayInput.style.color = '#fff';

        const dotRow = document.createElement('div');
        dotRow.style.display = 'flex';
        dotRow.style.alignItems = 'center';
        dotRow.style.gap = '6px';

        const dotLabel = document.createElement('span');
        dotLabel.textContent = 'Dot size';

        const dotInput = document.createElement('input');
        dotInput.type = 'number';
        dotInput.min = '1';
        dotInput.step = '0.5';
        dotInput.value = state.dotSize.toFixed(1);
        dotInput.style.width = '64px';
        dotInput.style.padding = '2px 4px';
        dotInput.style.fontSize = '11px';
        dotInput.style.border = '1px solid rgba(255,255,255,0.25)';
        dotInput.style.borderRadius = '4px';
        dotInput.style.background = 'rgba(255,255,255,0.08)';
        dotInput.style.color = '#fff';

        /** Update the delay state from the input. */
        function updateDelay() {
            const seconds = Number(delayInput.value);
            if (!Number.isFinite(seconds)) return;
            const clamped = NLS.clamp(seconds, 0, 600);
            state.delayMs = clamped * 1000;
        }

        /** Update the dot size state and redraw the map. */
        function updateDotSize() {
            const size = Number(dotInput.value);
            if (!Number.isFinite(size)) return;
            state.dotSize = NLS.clamp(size, 1, 10);
            NLS.renderTrackMap();
        }

        /** @param {KeyboardEvent} e */
        function stopPlayerShortcuts(e) {
            e.stopPropagation();
        }

        /** @param {KeyboardEvent} e */
        function stopPlayerShortcutsAndDefaultForSpace(e) {
            e.stopPropagation();
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
            }
        }

        delayInput.addEventListener('input', updateDelay);
        delayInput.addEventListener('keydown', stopPlayerShortcutsAndDefaultForSpace, true);
        delayInput.addEventListener('keypress', stopPlayerShortcuts, true);
        delayInput.addEventListener('keyup', stopPlayerShortcuts, true);

        dotInput.addEventListener('input', updateDotSize);
        dotInput.addEventListener('keydown', stopPlayerShortcutsAndDefaultForSpace, true);
        dotInput.addEventListener('keypress', stopPlayerShortcuts, true);
        dotInput.addEventListener('keyup', stopPlayerShortcuts, true);

        delayRow.appendChild(delayLabel);
        delayRow.appendChild(delayInput);
        dotRow.appendChild(dotLabel);
        dotRow.appendChild(dotInput);

        // Clear cache button
        const cacheRow = document.createElement('div');
        cacheRow.style.display = 'flex';
        cacheRow.style.alignItems = 'center';
        cacheRow.style.gap = '6px';
        cacheRow.style.marginTop = '6px';
        cacheRow.style.paddingTop = '6px';
        cacheRow.style.borderTop = '1px solid rgba(255,255,255,0.2)';

        const cacheBtn = document.createElement('button');
        cacheBtn.type = 'button';
        cacheBtn.textContent = 'Clear Cache';
        cacheBtn.style.flex = '1';
        cacheBtn.style.padding = '3px 6px';
        cacheBtn.style.fontSize = '10px';
        cacheBtn.style.background = 'rgba(255,100,100,0.3)';
        cacheBtn.style.border = '1px solid rgba(255,100,100,0.5)';
        cacheBtn.style.borderRadius = '3px';
        cacheBtn.style.color = '#fff';
        cacheBtn.style.cursor = 'pointer';
        cacheBtn.title = 'Clear cached sector times for all cars';

        cacheBtn.addEventListener('click', () => {
            if (confirm('Clear cached sector times? You\'ll need to wait for timing data on reload.')) {
                NLS.storage?.clearSectorTimesCache();
                const stats = NLS.storage?.getStats();
                alert('Cache cleared. Cache now: ' + (stats?.cacheSize || '0 KB'));
            }
        });

        const cacheStats = document.createElement('span');
        cacheStats.style.fontSize = '9px';
        cacheStats.style.opacity = '0.7';
        
        function updateCacheStats() {
            const stats = NLS.storage?.getStats();
            cacheStats.textContent = stats ? `${stats.carCount} cars, ${stats.cacheSize}` : '';
        }
        updateCacheStats();
        setInterval(updateCacheStats, 5000);

        cacheRow.appendChild(cacheBtn);
        cacheRow.appendChild(cacheStats);

        box.appendChild(header);
        box.appendChild(delayRow);
        box.appendChild(dotRow);
        box.appendChild(cacheRow);
        player.appendChild(box);

        box.style.display = state.settingsOpen ? 'flex' : 'none';

        state.settingsBox = box;

        // Setup window manager (draggable, resizable, hideable)
        NLS.setupWindow(box, header, 'settings_panel', 200, 120);

        return box;
    }

    NLS.ensureSettingsToggle = ensureSettingsToggle;
    NLS.ensureSettingsOverlay = ensureSettingsOverlay;
})();
