(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { SETTINGS_BOX_ID, SETTINGS_TOGGLE_ID } = NLS.IDS;

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

        function updateDelay() {
            const seconds = Number(delayInput.value);
            if (!Number.isFinite(seconds)) return;
            const clamped = NLS.clamp(seconds, 0, 600);
            state.delayMs = clamped * 1000;
        }

        function updateDotSize() {
            const size = Number(dotInput.value);
            if (!Number.isFinite(size)) return;
            state.dotSize = NLS.clamp(size, 1, 10);
            NLS.renderTrackMap();
        }

        function stopPlayerShortcuts(e) {
            e.stopPropagation();
        }

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
        box.appendChild(delayRow);
        box.appendChild(dotRow);
        player.appendChild(box);

        box.style.display = state.settingsOpen ? 'block' : 'none';

        state.settingsBox = box;

        return box;
    }

    NLS.ensureSettingsToggle = ensureSettingsToggle;
    NLS.ensureSettingsOverlay = ensureSettingsOverlay;
})();
