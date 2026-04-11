(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { OVERLAY_MANAGER_ID } = NLS.IDS;

    /**
     * Ensure the overlay manager control panel exists and is attached.
     * @returns {HTMLDivElement|null}
     */
    function ensureOverlayManager() {
        let panel = document.getElementById(OVERLAY_MANAGER_ID);
        const player = NLS.getPlayerContainer();
        if (!player) return panel || null;

        if (panel) {
            if (panel.parentElement !== player) player.appendChild(panel);
            return panel;
        }

        const style = window.getComputedStyle(player);
        if (style.position === 'static') {
            player.style.position = 'relative';
        }

        panel = document.createElement('div');
        panel.id = OVERLAY_MANAGER_ID;
        panel.style.position = 'absolute';
        panel.style.bottom = '10px';
        panel.style.left = '10px';
        panel.style.zIndex = '10000';
        panel.style.background = 'rgba(0,0,0,0.88)';
        panel.style.color = '#fff';
        panel.style.padding = '8px';
        panel.style.borderRadius = '6px';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.fontSize = '11px';
        panel.style.pointerEvents = 'auto';
        panel.style.boxSizing = 'border-box';
        panel.style.minWidth = '160px';

        const title = document.createElement('div');
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '6px';
        title.style.fontSize = '12px';
        title.textContent = 'Windows';

        panel.appendChild(title);

        const overlays = [
            { name: 'Leaderboard', key: 'main_leaderboard', id: NLS.IDS.MAIN_BOX_ID },
            { name: 'Relative Timing', key: 'relative_timing', id: NLS.IDS.REL_BOX_ID },
            { name: 'Track Map', key: 'track_map', id: NLS.IDS.MAP_BOX_ID },
            { name: 'Settings', key: 'settings_panel', id: NLS.IDS.SETTINGS_BOX_ID }
        ];

        overlays.forEach(overlay => {
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.style.display = 'flex';
            checkboxWrapper.style.alignItems = 'center';
            checkboxWrapper.style.marginBottom = '4px';
            checkboxWrapper.style.cursor = 'pointer';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.style.marginRight = '6px';
            checkbox.style.cursor = 'pointer';
            checkbox.style.accentColor = '#ff00ea';

            const label = document.createElement('label');
            label.textContent = overlay.name;
            label.style.cursor = 'pointer';
            label.style.flex = '1';

            const isHidden = localStorage.getItem(`nls_${overlay.key}_hidden`) === 'true';
            checkbox.checked = !isHidden;

            checkbox.addEventListener('change', () => {
                const box = document.getElementById(overlay.id);
                if (!box) return;

                const shouldHide = !checkbox.checked;
                localStorage.setItem(`nls_${overlay.key}_hidden`, shouldHide);
                box.style.display = shouldHide ? 'none' : (overlay.key === 'settings_panel' ? 'flex' : (overlay.key === 'track_map' ? 'flex' : 'flex'));
            });

            checkboxWrapper.appendChild(checkbox);
            checkboxWrapper.appendChild(label);
            panel.appendChild(checkboxWrapper);
        });

        player.appendChild(panel);
        state.overlayManager = panel;

        return panel;
    }

    /**
     * Recreate the overlay manager with updated checkboxes.
     */
    function refreshOverlayManager() {
        const player = NLS.getPlayerContainer();
        if (!player) return;

        const existing = document.getElementById(OVERLAY_MANAGER_ID);
        if (existing) existing.remove();

        ensureOverlayManager();
    }

    NLS.ensureOverlayManager = ensureOverlayManager;
    NLS.refreshOverlayManager = refreshOverlayManager;
})();
