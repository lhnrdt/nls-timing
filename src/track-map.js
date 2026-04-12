(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { MAP_BOX_ID } = NLS.IDS;

    /**
     * Ensure the track map overlay exists and is attached.
     * @returns {HTMLDivElement|null}
     */
    function ensureTrackMap() {
        let box = document.getElementById(MAP_BOX_ID);
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
        box.id = MAP_BOX_ID;
        box.style.position = 'absolute';
        box.style.top = '10px';
        box.style.right = '10px';
        box.style.zIndex = '9999';
        box.style.width = '440px';
        box.style.height = '440px';
        box.style.border = 'none';
        box.style.borderRadius = '0';
        box.style.background = 'rgba(0,0,0,0.45)';
        box.style.boxSizing = 'border-box';
        box.style.pointerEvents = 'auto';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';

        const header = document.createElement('div');
        header.style.padding = '4px 8px';
        header.style.background = 'rgba(0,0,0,0.5)';
        header.style.fontSize = '11px';
        header.style.fontWeight = 'bold';
        header.style.color = '#fff';
        header.style.textAlign = 'center';
        header.textContent = 'Track Map';

        const svgWrapper = document.createElement('div');
        svgWrapper.style.flex = '1';
        svgWrapper.style.display = 'flex';
        svgWrapper.style.justifyContent = 'center';
        svgWrapper.style.alignItems = 'center';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 494 540');
        svg.setAttribute('width', '440');
        svg.setAttribute('height', '440');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const trackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        trackPath.setAttribute('fill', 'none');
        trackPath.setAttribute('stroke', 'rgb(255,255,255)');
        trackPath.setAttribute('stroke-width', '2.5');
        trackPath.setAttribute('stroke-linecap', 'round');
        trackPath.setAttribute('stroke-linejoin', 'round');
        trackPath.setAttribute('d', state.mapSvgData?.d || '');

        const markers = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const dots = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        svg.appendChild(trackPath);
        svg.appendChild(markers);
        svg.appendChild(dots);
        svgWrapper.appendChild(svg);
        box.appendChild(header);
        box.appendChild(svgWrapper);

        player.appendChild(box);
        state.mapBox = box;
        state.mapSvg = svg;
        state.mapTrackPath = trackPath;
        state.mapDots = dots;
        state.mapMarkers = markers;

        ensureTrackSvgData();

        // Setup window manager (draggable, resizable, hideable)
        NLS.setupWindow(box, header, 'track_map', 300, 300);

        return box;
    }

    /**
     * Fetch the track map SVG and cache its path and viewbox data.
     */
    function ensureTrackSvgData() {
        if (state.mapSvgData || state.mapSvgLoading) return;
        const url = NLS.CONFIG.trackMapUrl;
        const resourceText = typeof GM_getResourceText === 'function'
            ? GM_getResourceText('TRACKMAP')
            : null;
        if (!resourceText && !url) return;

        state.mapSvgLoading = true;
        NLS.log('Track map load', resourceText ? 'TM resource' : url);
        const loadSvgText = resourceText
            ? Promise.resolve(resourceText)
            : fetch(url).then(res => res.text());

        loadSvgText
            .then((svgText) => {
                const svgMatch = svgText.match(/<svg[^>]*>/i);
                const pathMatch = svgText.match(/<path[^>]*\sd=["']([^"']+)["'][^>]*>/i);
                if (!svgMatch || !pathMatch) return;

                const svgTag = svgMatch[0];
                const d = pathMatch[1] || '';
                const viewBoxMatch = svgTag.match(/viewBox=["']([^"']+)["']/i);
                const widthMatch = svgTag.match(/width=["']([^"']+)["']/i);
                const heightMatch = svgTag.match(/height=["']([^"']+)["']/i);
                const viewBox = viewBoxMatch ? viewBoxMatch[1] : null;
                const width = widthMatch ? widthMatch[1] : null;
                const height = heightMatch ? heightMatch[1] : null;
                const normalizedViewBox = viewBox || (width && height ? `0 0 ${width} ${height}` : null);

                state.mapSvgData = {
                    d,
                    viewBox: normalizedViewBox,
                    width,
                    height
                };

                if (state.mapTrackPath) {
                    state.mapTrackPath.setAttribute('d', d);
                }
                if (state.mapSvg && normalizedViewBox) {
                    state.mapSvg.setAttribute('viewBox', normalizedViewBox);
                }
                NLS.log('Track map loaded');
            })
            .catch((error) => {
                NLS.log('Track map load failed', error);
            })
            .finally(() => {
                state.mapSvgLoading = false;
            });
    }

    /**
     * Analyze track curvature and build sector-specific speed profiles
     * Maps elapsed time → actual distance, accounting for variable speeds based on curvature
     * Total sector time remains unchanged (matched to actual lap data)
     */
    function buildCurvatureProfile() {
        if (!state.mapTrackPath || state.curveProfiles) return;

        const pathLength = state.mapTrackPath.getTotalLength();
        const sampleDistance = 50; // Sample every 50px to capture meaningful curves
        const samples = [];

        // Sample path points and angles
        for (let length = 0; length <= pathLength; length += sampleDistance) {
            const point = state.mapTrackPath.getPointAtLength(length);
            samples.push({ length, x: point.x, y: point.y });
        }

        // Calculate curvature (angle change per unit distance) for each point
        const curvatures = [];
        for (let i = 0; i < samples.length; i++) {
            let curvature = 0;
            if (i > 0 && i < samples.length - 1) {
                const p0 = samples[i - 1];
                const p1 = samples[i];
                const p2 = samples[i + 1];

                const dx1 = p1.x - p0.x;
                const dy1 = p1.y - p0.y;
                const dx2 = p2.x - p1.x;
                const dy2 = p2.y - p1.y;

                const angle1 = Math.atan2(dy1, dx1);
                const angle2 = Math.atan2(dy2, dx2);
                let angleDiff = angle2 - angle1;

                // Normalize angle difference to (-π, π]
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;

                // Use absolute angle change as curvature
                curvature = Math.abs(angleDiff);
            }
            curvatures.push(curvature);
        }

        // Use percentile-based normalization for better distribution
        // This prevents one sharp curve from making everything else green
        const sortedCurvatures = [...curvatures].sort((a, b) => a - b);
        const p75Index = Math.floor(sortedCurvatures.length * 0.75);
        const maxCurvature = sortedCurvatures[p75Index] || 0.1; // Use 75th percentile

        const speedMultipliers = curvatures.map(c => {
            const normalizedCurvature = Math.min(c / maxCurvature, 1.0);
            return 1.0 - (normalizedCurvature * 0.35); // Range: 0.65x to 1.0x
        });

        // Build cumulative "time-weighted distance" to account for variable speeds
        // Higher curvature = slower speed = more time needed = larger time-weighted distance
        const timeWeightedDistance = [0];
        for (let i = 1; i < samples.length; i++) {
            const segmentLength = samples[i].length - samples[i - 1].length;
            const avgSpeedMult = (speedMultipliers[i] + speedMultipliers[i - 1]) / 2;
            // Time spent = distance / speed, so time-weighted distance = distance / speed
            const timeWeight = segmentLength / avgSpeedMult;
            timeWeightedDistance.push(timeWeightedDistance[timeWeightedDistance.length - 1] + timeWeight);
        }

        const totalTimeWeight = timeWeightedDistance[timeWeightedDistance.length - 1];

        state.curveProfiles = {
            samples,
            speedMultipliers,
            timeWeightedDistance,
            totalTimeWeight,
            pathLength,

            /**
             * Get speed multiplier (0.65-1.0) for a position along track
             * @param {number} pathLength distance along path
             * @returns {number} speed multiplier
             */
            getSpeedAt(pathLength) {
                const clamped = NLS.clamp(pathLength, 0, this.pathLength);
                let left = 0, right = samples.length - 1;
                while (left < right - 1) {
                    const mid = Math.floor((left + right) / 2);
                    if (samples[mid].length <= clamped) {
                        left = mid;
                    } else {
                        right = mid;
                    }
                }
                const s1 = speedMultipliers[left];
                const s2 = speedMultipliers[right];
                const t = samples[left].length === samples[right].length ? 0 :
                    (clamped - samples[left].length) / (samples[right].length - samples[left].length);
                return s1 + (s2 - s1) * t;
            },

            /**
             * Map elapsed time fraction to actual distance fraction, accounting for curvature
             * @param {number} timeFraction (0-1) how much time has elapsed in sector
             * @returns {number} actual distance fraction (0-1) accounting for variable speeds
             */
            getDistanceFractionForTime(timeFraction) {
                const targetTimeWeight = timeFraction * totalTimeWeight;
                
                // Binary search to find position in time-weighted distance
                let left = 0, right = timeWeightedDistance.length - 1;
                while (left < right - 1) {
                    const mid = Math.floor((left + right) / 2);
                    if (timeWeightedDistance[mid] <= targetTimeWeight) {
                        left = mid;
                    } else {
                        right = mid;
                    }
                }

                const p1 = samples[left];
                const p2 = samples[right];
                const w1 = timeWeightedDistance[left];
                const w2 = timeWeightedDistance[right];

                // Interpolate
                if (w1 === w2) return p1.length / this.pathLength;
                const t = (targetTimeWeight - w1) / (w2 - w1);
                const pathPos = p1.length + (p2.length - p1.length) * t;
                return pathPos / this.pathLength;
            }
        };
    }

    /**
     * Create a color based on speed multiplier (0.65-1.0)
     * Green (fast, 1.0x) to Red (slow, 0.65x)
     */
    function speedToColor(speedMult) {
        // Normalize speed multiplier (0.65-1.0) to 0-1 range
        const normalized = (speedMult - 0.65) / 0.35;
        const clamped = NLS.clamp(normalized, 0, 1);
        
        // Interpolate from Red (slow) to Green (fast)
        const r = Math.floor(255 * (1 - clamped));
        const g = Math.floor(255 * clamped);
        const b = 0;
        
        return `rgb(${r},${g},${b})`;
    }

    /**
     * Build the curvature-colored track visualization
     */
    function buildCurvatureTrackVisual() {
        if (!state.mapTrackPath || !state.curveProfiles) return;
        
        const profile = state.curveProfiles;
        const samples = profile.samples;
        
        if (!state.mapSvg || samples.length < 2) return;

        // Remove old colored segments if they exist
        if (state.mapCurvatureSegments) {
            state.mapCurvatureSegments.querySelectorAll('line').forEach(line => line.remove());
        } else {
            state.mapCurvatureSegments = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            // Insert AFTER the track path so colors are visible on top
            if (state.mapTrackPath.nextSibling) {
                state.mapSvg.insertBefore(state.mapCurvatureSegments, state.mapTrackPath.nextSibling);
            } else {
                state.mapSvg.appendChild(state.mapCurvatureSegments);
            }
        }

        // Draw fine-grained colored segments by interpolating between coarse samples
        const visualSampleDistance = 3; // Draw color every 3px for smooth gradient
        const pathLength = state.mapTrackPath.getTotalLength();

        for (let length = 0; length < pathLength; length += visualSampleDistance) {
            const length2 = Math.min(length + visualSampleDistance, pathLength);
            const p1 = state.mapTrackPath.getPointAtLength(length);
            const p2 = state.mapTrackPath.getPointAtLength(length2);

            // Get speed multiplier at this position via interpolation
            const speedMult = getSpeedAtPathLength(profile, length);
            const color = speedToColor(speedMult);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', p1.x.toFixed(2));
            line.setAttribute('y1', p1.y.toFixed(2));
            line.setAttribute('x2', p2.x.toFixed(2));
            line.setAttribute('y2', p2.y.toFixed(2));
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', '2.8');
            line.setAttribute('stroke-opacity', '0.9');
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('stroke-linejoin', 'round');

            state.mapCurvatureSegments.appendChild(line);
        }
    }

    /**
     * Get speed multiplier at a specific path length via interpolation
     */
    function getSpeedAtPathLength(profile, pathLength) {
        const samples = profile.samples;
        const speedMults = profile.speedMultipliers;
        const clamped = NLS.clamp(pathLength, 0, profile.pathLength);

        // Binary search to find surrounding samples
        let left = 0, right = samples.length - 1;
        while (left < right - 1) {
            const mid = Math.floor((left + right) / 2);
            if (samples[mid].length <= clamped) {
                left = mid;
            } else {
                right = mid;
            }
        }

        const s1 = speedMults[left];
        const s2 = speedMults[right];
        
        if (samples[left].length === samples[right].length) {
            return s1;
        }

        const t = (clamped - samples[left].length) / (samples[right].length - samples[left].length);
        return s1 + (s2 - s1) * t;
    }

    /**
     * Get interpolated point on path - caches getTotalLength and uses memoization for getPointAtLength
     */
    function getPathPointFast(length) {
        if (!state.mapTrackPath) return null;

        // Initialize cache on first use
        if (!state.pathPointCache) {
            state.pathPointCache = new Map();
            if (!state.pathTotalLength) {
                state.pathTotalLength = state.mapTrackPath.getTotalLength();
            }
        }

        const pathLength = state.pathTotalLength || state.mapTrackPath.getTotalLength();
        const clamped = NLS.clamp(length, 0, pathLength);
        
        // Use memoization with 1px precision (sub-pixel accuracy not needed)
        const cacheKey = Math.round(clamped);
        if (state.pathPointCache.has(cacheKey)) {
            return state.pathPointCache.get(cacheKey);
        }

        // Call actual SVG method and cache result
        const point = state.mapTrackPath.getPointAtLength(clamped);
        state.pathPointCache.set(cacheKey, point);
        
        // Limit cache size to prevent memory bloat
        if (state.pathPointCache.size > 5000) {
            const firstKey = state.pathPointCache.keys().next().value;
            state.pathPointCache.delete(firstKey);
        }

        return point;
    }

    /**
     * Render car dots and markers on the SVG track map.
     */
    function renderTrackMap() {
        if (!state.mapDots || !state.mapMarkers || !state.mapTrackPath) return;
        if (!state.latestPayload) return;

        const model = NLS.getTrackModel(state.latestPayload);
        if (!model) return;

        const serverNowMs = NLS.getServerNowMs();
        const selected = state.selectedStartNumber.trim();

        // Get cached path length
        const pathLength = NLS.getPathTotalLength();
        if (!Number.isFinite(pathLength) || pathLength <= 0) return;

        // Build curvature profile on first render
        if (!state.curveProfiles) buildCurvatureProfile();
        
        // Build curvature-colored track visualization
        if (state.curveProfiles && !state.mapCurvatureSegments) {
            buildCurvatureTrackVisual();
        }

        // Batch DOM updates using DocumentFragment to minimize reflows
        const markersFragment = document.createDocumentFragment();
        const dotsFragment = document.createDocumentFragment();

        /**
         * Resolve a class color for a car class string.
         * @param {string} className
         * @returns {string}
         */
        function classColor(className) {
            const text = NLS.normalizeText(className).toUpperCase();
            const key = text.replace(/[^A-Z0-9]/g, '');
            const prefixMatch = key.match(/^[A-Z]+\d+/);
            const prefix = prefixMatch ? prefixMatch[0] : key;

            const palette = {
                SP9: '#3b82f6',
                SP10: '#8b5cf6',
                SP8: '#f59e0b',
                SP7: '#22c55e',
                SP6: '#06b6d4',
                SP5: '#10b981',
                SP4: '#14b8a6',
                SP3: '#ef4444',
                SP2: '#eab308',
                SP1: '#f97316',
                CUP: '#9ca3af',
                VT2: '#0ea5e9',
                AT3: '#84cc16',
                AT2: '#a3e635'
            };

            if (palette[prefix]) return palette[prefix];
            if (palette[key]) return palette[key];
            return '#cbd5f5';
        }

        /**
         * Draw a perpendicular marker line at a track distance.
         * @param {number} length
         * @param {string} color
         * @param {string} width
         * @param {number} size
         */
        function addMarkerAtLength(fragment, length, color, width, size, tooltip) {
            const base = NLS.clamp(length, 0, pathLength);
            const p1 = getPathPointFast(base);
            const p2 = getPathPointFast(NLS.clamp(base + 1, 0, pathLength));
            if (!p1 || !p2) return;

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const half = size / 2;
            const x1 = p1.x - nx * half;
            const y1 = p1.y - ny * half;
            const x2 = p1.x + nx * half;
            const y2 = p1.y + ny * half;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1.toFixed(2));
            line.setAttribute('y1', y1.toFixed(2));
            line.setAttribute('x2', x2.toFixed(2));
            line.setAttribute('y2', y2.toFixed(2));
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', width);
            line.setAttribute('stroke-linecap', 'round');
            
            if (tooltip) {
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = tooltip;
                line.appendChild(title);
                line.style.cursor = 'pointer';
            }
            
            fragment.appendChild(line);
        }

        // Add markers and dots to fragments first (no DOM reflows)
        addMarkerAtLength(markersFragment, 0, 'rgba(0,255,100,0.8)', '3', 26, 'START/FINISH');

        model.cumulative.forEach((distance, idx) => {
            const fraction = distance / model.trackLength;
            const sectorNum = idx + 1;
            addMarkerAtLength(markersFragment, fraction * pathLength, 'rgba(100,180,255,0.7)', '2.5', 20, `Sector ${sectorNum} End`);
        });

        state.cars.forEach(car => {
            const progress = NLS.getCarProgress(car);
            if (!progress || !Number.isFinite(progress.lapDistance)) return;

            const fraction = progress.lapDistance / model.trackLength;
            if (!Number.isFinite(fraction)) return;
            
            const point = getPathPointFast(NLS.clamp(fraction, 0, 1) * pathLength);
            if (!point) return;

            const x = point.x;
            const y = point.y;
            const isSelected = NLS.normalizeText(car.STNR) === selected;
            const dotColor = classColor(car.CLASSNAME);

            if (isSelected) {
                const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                halo.setAttribute('cx', x.toFixed(2));
                halo.setAttribute('cy', y.toFixed(2));
                halo.setAttribute('r', '6');
                halo.setAttribute('fill', 'none');
                halo.setAttribute('stroke', '#22c55e');
                halo.setAttribute('stroke-width', '2');
                dotsFragment.appendChild(halo);
            }

            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', x.toFixed(2));
            dot.setAttribute('cy', y.toFixed(2));
            const baseSize = NLS.clamp(Number(state.dotSize) || NLS.CONFIG.defaultDotSize, 1, 10);
            const radius = isSelected ? baseSize + 1 : baseSize;
            dot.setAttribute('r', radius.toFixed(1));
            dot.setAttribute('fill', dotColor);
            dot.setAttribute('stroke', isSelected ? '#22c55e' : 'rgba(0,0,0,0.5)');
            dot.setAttribute('stroke-width', '0.5');
            dot.style.cursor = 'pointer';
            dot.style.pointerEvents = 'auto';

            // Add tooltip with car information
            const speedKmh = (progress.speedMps * 3.6).toFixed(1);
            const lapNum = NLS.toNumber(car.LAPS) ?? 0;
            const distanceKm = (progress.lapDistance / 1000).toFixed(2);
            const className = NLS.normalizeText(car.CLASSNAME);
            const stnr = NLS.normalizeText(car.STNR);
            
            let tooltipText = `#${stnr} - ${className}\n`;
            tooltipText += `Lap ${lapNum}\n`;
            tooltipText += `Distance: ${distanceKm}km\n`;
            tooltipText += `Speed: ${speedKmh}km/h`;
            
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = tooltipText;
            dot.appendChild(title);

            dot.addEventListener('click', (event) => {
                event.stopPropagation();
                state.selectedStartNumber = NLS.normalizeText(car.STNR);
                if (state.relInput) state.relInput.value = state.selectedStartNumber;
                NLS.renderRelative();
                renderTrackMap();
            });
            dotsFragment.appendChild(dot);
        });

        // Batch update DOM: clear and append all at once (single reflow)
        state.mapMarkers.replaceChildren(markersFragment);
        state.mapDots.replaceChildren(dotsFragment);
    }

    NLS.ensureTrackMap = ensureTrackMap;
    NLS.renderTrackMap = renderTrackMap;
    NLS.buildCurvatureProfile = buildCurvatureProfile;
    NLS.getCurveProfiles = () => state.curveProfiles;
    NLS.getPathTotalLength = () => {
        if (!state.mapTrackPath) return 0;
        if (!state.pathTotalLength) {
            state.pathTotalLength = state.mapTrackPath.getTotalLength();
        }
        return state.pathTotalLength;
    };
})();
