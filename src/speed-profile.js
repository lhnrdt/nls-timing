// Speed profile graph overlay for displaying lap speed at each track distance
(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const SPEED_PROFILE_ID = 'nls_speed_profile';

    /**
     * Ensure speed profile overlay exists
     * @returns {HTMLDivElement|null}
     */
    function ensureSpeedProfileOverlay() {
        if (state.speedProfileBox) return state.speedProfileBox;

        const container = document.createElement('div');
        container.id = SPEED_PROFILE_ID;
        container.style.position = 'absolute';
        container.style.top = '100px';
        container.style.left = '100px';
        container.style.width = '600px';
        container.style.height = '400px';
        container.style.background = 'rgba(0,0,0,0.88)';
        container.style.color = '#fff';
        container.style.padding = '8px';
        container.style.display = 'none';
        container.style.flexDirection = 'column';
        container.style.zIndex = '9999';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.fontSize = '11px';
        container.style.pointerEvents = 'auto';
        container.style.borderRadius = '6px';
        container.style.boxSizing = 'border-box';
        container.style.overflow = 'hidden';  // Prevent content overflow

        // Header with close button
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '6px';
        header.style.paddingBottom = '6px';
        header.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
        header.style.userSelect = 'none';

        const title = document.createElement('span');
        title.style.fontWeight = 'bold';
        title.style.fontSize = '12px';
        title.textContent = 'Speed Profile - Last Lap';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = '#fff';
        closeBtn.style.fontSize = '14px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.padding = '0';
        closeBtn.style.width = '20px';
        closeBtn.style.height = '20px';
        closeBtn.style.display = 'flex';
        closeBtn.style.alignItems = 'center';
        closeBtn.style.justifyContent = 'center';
        closeBtn.addEventListener('click', () => {
            container.style.display = 'none';
        });

        header.appendChild(title);
        header.appendChild(closeBtn);
        container.appendChild(header);

        // Canvas for graph
        const canvas = document.createElement('canvas');
        canvas.id = 'nls_speed_profile_canvas';
        canvas.style.flex = '1';
        canvas.style.background = 'rgba(0,0,0,0.5)';
        canvas.style.border = '1px solid rgba(255,255,255,0.1)';
        canvas.style.borderRadius = '4px';
        container.appendChild(canvas);

        state.speedProfileBox = container;
        state.speedProfileCanvas = canvas;
        state.speedProfileCtx = canvas.getContext('2d');

        // Make draggable and resizable
        if (NLS.makeDraggable) {
            NLS.makeDraggable(container, header);
        }
        if (NLS.makeResizable) {
            NLS.makeResizable(container, 400, 250);
        }

        // Load saved position
        if (NLS.storage) {
            const rect = NLS.storage.loadWindowRect(SPEED_PROFILE_ID);
            if (rect) {
                container.style.top = rect.top + 'px';
                container.style.left = rect.left + 'px';
                container.style.width = rect.width + 'px';
                container.style.height = rect.height + 'px';
            }
        }

        return container;
    }

    /**
     * Get or create speed profile data for a car
     * Uses cached sector times to estimate speed profile
     */
    function getSpeedProfile(car, model) {
        if (!model || !car) return null;

        const stnr = NLS.normalizeText(car.STNR);
        
        // Build speed profile from sector times
        const profile = {
            distances: [],    // Track distance (m)
            speeds: []         // Speed (km/h)
        };

        let cumulativeDistance = 0;
        const sectors = model.sectors || [];
        
        // Add speed at start/finish
        profile.distances.push(0);
        profile.speeds.push(0);  // Speed at start is 0

        for (let i = 0; i < sectors.length; i++) {
            const sectorNum = i + 1;
            const sectorKey = `S${sectorNum}TIME`;
            const sectorDistance = sectors[i];

            // Get cached sector time
            const cachedTimeMs = NLS.storage?.loadSectorTime(stnr, sectorKey);
            if (Number.isFinite(cachedTimeMs) && cachedTimeMs > 0) {
                const sectorTimeSeconds = cachedTimeMs / 1000;
                const speedMps = sectorDistance / sectorTimeSeconds;
                const speedKmh = speedMps * 3.6;

                // Add intermediate point and end point for this sector
                cumulativeDistance += sectorDistance;
                profile.distances.push(cumulativeDistance);
                profile.speeds.push(speedKmh);
            }
        }

        // If we have at least 2 points, return the profile
        if (profile.distances.length >= 2) {
            return profile;
        }

        return null;
    }

    /**
     * Render speed profile graph on canvas
     */
    function renderSpeedProfile(car, model) {
        const canvas = state.speedProfileCanvas;
        const ctx = state.speedProfileCtx;
        if (!canvas || !ctx) return;

        const profile = getSpeedProfile(car, model);
        if (!profile || profile.distances.length < 2) {
            // Set minimum size for error message
            if (canvas.width === 0) canvas.width = 600;
            if (canvas.height === 0) canvas.height = 400;
            ctx.fillStyle = '#fff';
            ctx.font = '12px monospace';
            ctx.fillText('No profile data available', 20, 50);
            return;
        }

        // Resize canvas to fit container  (must account for padding)
        const rect = canvas.parentElement.getBoundingClientRect();
        const actualWidth = Math.max(100, rect.width || 600 - 16);  // Subtract padding
        const actualHeight = Math.max(100, rect.height || 400 - 80);  // Subtract header and padding
        
        canvas.width = actualWidth;
        canvas.height = actualHeight;

        const padding = { top: 20, right: 20, bottom: 40, left: 60 };
        const graphWidth = canvas.width - padding.left - padding.right;
        const graphHeight = canvas.height - padding.top - padding.bottom;

        // Find min/max for scaling
        const maxDistance = Math.max(...profile.distances);
        const maxSpeed = Math.max(...profile.speeds);
        const minSpeed = 0;  // Always start at 0
        const speedRange = maxSpeed - minSpeed || 1;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Vertical grid (distance)
        for (let i = 0; i <= 5; i++) {
            const x = padding.left + (i / 5) * graphWidth;
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, canvas.height - padding.bottom);
            ctx.stroke();
        }

        // Horizontal grid (speed)
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (i / 5) * graphHeight;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(canvas.width - padding.right, y);
            ctx.stroke();
        }

        // Draw axes
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, canvas.height - padding.bottom);
        ctx.lineTo(canvas.width - padding.right, canvas.height - padding.bottom);
        ctx.stroke();

        // Draw labels and tick marks
        ctx.fillStyle = '#fff';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';

        // Distance labels (X axis)
        for (let i = 0; i <= 5; i++) {
            const dist = (i / 5) * maxDistance;
            const x = padding.left + (i / 5) * graphWidth;
            ctx.fillText(Math.round(dist / 1000) + 'km', x, canvas.height - padding.bottom + 18);
            
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, canvas.height - padding.bottom - 3);
            ctx.lineTo(x, canvas.height - padding.bottom + 3);
            ctx.stroke();
        }

        // Speed labels (Y axis)
        ctx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
            const speed = minSpeed + (i / 5) * speedRange;
            const y = padding.top + (1 - i / 5) * graphHeight;
            ctx.fillText(Math.round(speed) + ' km/h', padding.left - 8, y + 3);
            
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padding.left - 3, y);
            ctx.lineTo(padding.left + 3, y);
            ctx.stroke();
        }

        // Draw speed profile as step chart
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let i = 0; i < profile.distances.length; i++) {
            const x = padding.left + (profile.distances[i] / maxDistance) * graphWidth;
            const y = padding.top + (1 - (profile.speeds[i] - minSpeed) / speedRange) * graphHeight;
            
            if (i === 0) {
                // Start at first point
                ctx.moveTo(x, y);
            } else {
                // Step: horizontal line to next x, then vertical to next y
                const prevX = padding.left + (profile.distances[i - 1] / maxDistance) * graphWidth;
                const prevY = padding.top + (1 - (profile.speeds[i - 1] - minSpeed) / speedRange) * graphHeight;
                
                // Horizontal to next x position
                ctx.lineTo(x, prevY);
                // Vertical to next y position
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Draw points
        ctx.fillStyle = '#22c55e';
        for (let i = 0; i < profile.distances.length; i++) {
            const x = padding.left + (profile.distances[i] / maxDistance) * graphWidth;
            const y = padding.top + (1 - (profile.speeds[i] - minSpeed) / speedRange) * graphHeight;
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }

        // Draw title with car info
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left';
        const carInfo = `#${NLS.normalizeText(car.STNR)} - ${NLS.normalizeText(car.CLASSNAME)}`;
        ctx.fillText(carInfo, padding.left, padding.top - 8);
    }

    /**
     * Show speed profile for selected car
     */
    function showSpeedProfile(car) {
        if (!car) return;

        const overlay = ensureSpeedProfileOverlay();
        const model = NLS.getTrackModel(state.latestPayload);
        if (!model) return;

        overlay.style.display = 'flex';
        
        // Render on next frame to ensure canvas is sized
        requestAnimationFrame(() => {
            renderSpeedProfile(car, model);
        });
    }

    // Export functions
    NLS.ensureSpeedProfileOverlay = ensureSpeedProfileOverlay;
    NLS.showSpeedProfile = showSpeedProfile;

})();
