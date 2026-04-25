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
        container.style.width = '650px';
        container.style.height = '450px';
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
            NLS.makeResizable(container, 450, 300);
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
        const sectors = model.sectors || [];
        if (sectors.length === 0) return null;

        const profile = {
            sectors: [],
            maxSpeedKmh: 0
        };

        for (let i = 0; i < sectors.length; i++) {
            const sectorNum = i + 1;
            const sectorDistance = sectors[i];
            const cachedTimeMs = NLS.storage?.loadSectorTime(stnr, `S${sectorNum}TIME`);

            let speedMps = null;
            let sourceType = 'default';
            let sourceLabel = 'Default fallback';
            let sourceStartNumber = null;

            if (Number.isFinite(cachedTimeMs) && cachedTimeMs > 0) {
                const sectorTimeSeconds = cachedTimeMs / 1000;
                speedMps = sectorDistance / sectorTimeSeconds;
                sourceType = 'cached';
                sourceLabel = `Cached S${sectorNum}`;
            } else {
                const classFallback = findClassBasedSectorTime(car, sectorNum);
                if (classFallback) {
                    speedMps = sectorDistance / classFallback.timeSeconds;
                    sourceType = 'class';
                    sourceLabel = `Class fallback from #${classFallback.sourceSttnr}`;
                    sourceStartNumber = classFallback.sourceSttnr;
                } else {
                    speedMps = 60;
                    sourceType = 'default';
                    sourceLabel = 'Default fallback';
                }
            }

            const speedKmh = speedMps * 3.6;
            profile.maxSpeedKmh = Math.max(profile.maxSpeedKmh, speedKmh);
            profile.sectors.push({
                sectorNum,
                distance: sectorDistance,
                speedMps,
                speedKmh,
                sourceType,
                sourceLabel,
                sourceStartNumber
            });
        }

        return profile;
    }

    /**
     * Find a sector time from another car in the same class.
     * Returns the first cached sector time found.
     */
    function findClassBasedSectorTime(car, sectorNum) {
        if (!NLS.state?.cars || !NLS.storage?.loadSectorTime) return null;

        const carClass = NLS.normalizeText(car.CLASSNAME);
        const sectorKey = `S${sectorNum}TIME`;

        for (const otherCar of NLS.state.cars) {
            if (otherCar === car) continue;
            if (NLS.normalizeText(otherCar.CLASSNAME) !== carClass) continue;

            const cachedTimeMs = NLS.storage.loadSectorTime(otherCar.STNR, sectorKey);
            if (Number.isFinite(cachedTimeMs) && cachedTimeMs > 0) {
                return {
                    timeSeconds: cachedTimeMs / 1000,
                    sourceSttnr: NLS.normalizeText(otherCar.STNR)
                };
            }
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
        if (!profile || !profile.sectors || profile.sectors.length === 0) {
            // Set minimum size for error message
            if (canvas.width === 0) canvas.width = 650;
            if (canvas.height === 0) canvas.height = 450;
            ctx.fillStyle = '#fff';
            ctx.font = '12px monospace';
            ctx.fillText('No profile data available', 20, 50);
            return;
        }

        // Resize canvas to fit container  (must account for padding)
        const rect = canvas.parentElement.getBoundingClientRect();
        const actualWidth = Math.max(100, rect.width || 650 - 16);  // Subtract padding
        const actualHeight = Math.max(100, rect.height || 450 - 80);  // Subtract header and padding
        
        canvas.width = actualWidth;
        canvas.height = actualHeight;

        const padding = { top: 20, right: 20, bottom: 78, left: 60 };
        const graphWidth = canvas.width - padding.left - padding.right;
        const graphHeight = canvas.height - padding.top - padding.bottom;

        // Find min/max for scaling
        const maxSpeed = Math.max(1, ...profile.sectors.map(sector => sector.speedKmh));
        const minSpeed = 0;  // Always start at 0
        const speedRange = maxSpeed - minSpeed || 1;

        const sourceColors = {
            cached: '#22c55e',
            class: '#f59e0b',
            default: '#64748b'
        };

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

        // Distance labels (X axis) - always show every sector
        const sectorCount = profile.sectors.length;
        for (let i = 0; i < sectorCount; i++) {
            const sector = profile.sectors[i];
            const x = padding.left + ((i + 0.5) / sectorCount) * graphWidth;
            const distLabel = Math.round(sector.distance / 1000) + 'km';
            ctx.fillText(`S${sector.sectorNum} ${distLabel}`, x, canvas.height - padding.bottom + 18);
            
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

        // Draw speed profile as a bar chart by sector
        const barAreaLeft = padding.left + 2;
        const barAreaRight = canvas.width - padding.right - 2;
        const barAreaWidth = barAreaRight - barAreaLeft;
        const gap = sectorCount > 1 ? Math.max(6, Math.min(12, barAreaWidth * 0.015)) : 0;
        const barWidth = Math.max(12, (barAreaWidth - gap * (sectorCount - 1)) / sectorCount);

        for (let i = 0; i < profile.sectors.length; i++) {
            const sector = profile.sectors[i];
            const left = barAreaLeft + i * (barWidth + gap);
            const barHeight = ((sector.speedKmh - minSpeed) / speedRange) * graphHeight;
            const top = padding.top + graphHeight - barHeight;
            const bottom = padding.top + graphHeight;
            const color = sourceColors[sector.sourceType] || sourceColors.default;

            ctx.fillStyle = color;
            ctx.fillRect(left, top, barWidth, bottom - top);

            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.strokeRect(left, top, barWidth, bottom - top);

            ctx.save();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.font = '10px monospace';
            ctx.fillText(Math.round(sector.speedKmh) + ' km/h', left + barWidth / 2, Math.max(padding.top + 10, top - 4));
            ctx.restore();
        }

        // Draw title with car info
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left';
        const carInfo = `#${NLS.normalizeText(car.STNR)} - ${NLS.normalizeText(car.CLASSNAME)}`;
        ctx.fillText(carInfo, padding.left, padding.top - 8);

        // Draw sector availability legend
        if (profile.sectors.length > 0) {
            const legendY = canvas.height - padding.bottom + 35;
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff';
            ctx.fillText('Source:', padding.left, legendY);

            const legendItems = [
                { label: 'Cached', color: sourceColors.cached },
                { label: 'Same class', color: sourceColors.class },
                { label: 'Default', color: sourceColors.default }
            ];

            let legendX = padding.left + 54;
            for (const item of legendItems) {
                const boxSize = 14;
                ctx.fillStyle = item.color;
                ctx.fillRect(legendX, legendY - 10, boxSize, boxSize);

                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left';
                ctx.fillText(item.label, legendX + boxSize + 4, legendY + 2);
                legendX += 88;
            }
            
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left';
            ctx.fillText('Green = cached, amber = same class, gray = default', padding.left, legendY + 18);

            const indicatorY = legendY + 35;
            ctx.fillText('Sectors:', padding.left, indicatorY);

            let indicatorX = padding.left + 54;
            for (let i = 0; i < profile.sectors.length; i++) {
                const sector = profile.sectors[i];
                const boxSize = 14;
                const boxColor = sourceColors[sector.sourceType] || sourceColors.default;
                ctx.fillStyle = boxColor;
                ctx.fillRect(indicatorX, indicatorY - 10, boxSize, boxSize);

                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText('S' + sector.sectorNum, indicatorX + boxSize / 2, indicatorY + 2);

                indicatorX += boxSize + 12;
            }
        }
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
        
        // Store last viewed car for quick reopen
        state.lastSpeedProfileCar = car;

        // Render on next frame to ensure canvas is sized
        requestAnimationFrame(() => {
            renderSpeedProfile(car, model);
        });
    }

    /**
     * Reopen last viewed speed profile
     */
    function reopenLastSpeedProfile() {
        if (state.lastSpeedProfileCar) {
            showSpeedProfile(state.lastSpeedProfileCar);
        }
    }

    // Export functions
    NLS.ensureSpeedProfileOverlay = ensureSpeedProfileOverlay;
    NLS.showSpeedProfile = showSpeedProfile;
    NLS.reopenLastSpeedProfile = reopenLastSpeedProfile;

    // Add keyboard shortcut to reopen profile (Ctrl+P)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
            if (state.lastSpeedProfileCar) {
                e.preventDefault();
                reopenLastSpeedProfile();
            }
        }
    });

})();
