(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { MAP_BOX_ID } = NLS.IDS;

    /**
     * Single source of truth for car class colors
     */
    const CLASS_COLORS = {
        // VLN Production - Muted
        VT1: '#ffffffff',
        VT2: '#ffffffff',
        VT3: '#ffffffff',
        V3: '#ffffffff',
        V4: '#ffffffff',
        V5: '#ffffffff',
        V6: '#ffffffff',
        
        // SP classes - vibrant by displacement
        SP2: '#ffffffff',    // Amber
        SP3: '#ffffffff',    // Orange
        SP4: '#ffffffff',    // Orange-red
        SP5: '#ffffffff',    // Vibrant green
        SP6: '#ffffffff',    // Teal
        SP7: '#ffffffff',    // Cyan
        SP8: '#0ea5e9',    // Sky blue
        SP9: '#eb2525ff',    // Vibrant blue (GT3)
        SP10: '#55f7a6ff',   // Vibrant purple (GT4)
        SPPRO: '#ee4d0dff',  // Vibrant violet
        SPX: '#d946ef',    // Vibrant magenta
        
        // Alternative fuel - Vibrant lime
        AT: '#84cc16',
        AT2: '#bffc15',
        AT3: '#d4fc79',
        
        // Cup & Special - Gray/muted
        CUP: '#0b4bb9ff',
        TCR: '#858585ff',
        OPC: '#646464ff',
        BMW: '#ffffffff',
        
        // Gruppe H - Brown
        H2: '#ffffffff',
        H4: '#ffffffff'
    };

    /**
     * Canvas-based track map renderer
     * - Track visualization
     * - Start/finish and sector markers
     * - Car position dots
     * - Hover tooltips for interactive feedback
     */

    /**
     * Ensure the track map canvas overlay exists and is attached
     * @returns {HTMLCanvasElement|null}
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

        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.flex = '1';
        canvasWrapper.style.display = 'flex';
        canvasWrapper.style.justifyContent = 'center';
        canvasWrapper.style.alignItems = 'center';
        canvasWrapper.style.position = 'relative';

        const canvas = document.createElement('canvas');
        canvas.width = 494;
        canvas.height = 540;
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = '100%';
        canvas.style.display = 'block';

        canvasWrapper.appendChild(canvas);
        
        // Create legend
        const legend = document.createElement('div');
        legend.style.padding = '6px 8px';
        legend.style.background = 'rgba(0,0,0,0.3)';
        legend.style.fontSize = '10px';
        legend.style.color = '#fff';
        legend.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        legend.style.display = 'grid';
        legend.style.gridTemplateColumns = '1fr 1fr';
        legend.style.gap = '4px';
        
        const classGroups = [
            { label: 'VT1', color: CLASS_COLORS.VT1 },
            { label: 'VT2', color: CLASS_COLORS.VT2 },
            { label: 'VT3', color: CLASS_COLORS.VT3 },
            { label: 'SP2', color: CLASS_COLORS.SP2 },
            { label: 'SP3', color: CLASS_COLORS.SP3 },
            { label: 'SP4', color: CLASS_COLORS.SP4 },
            { label: 'SP5', color: CLASS_COLORS.SP5 },
            { label: 'SP6', color: CLASS_COLORS.SP6 },
            { label: 'SP7', color: CLASS_COLORS.SP7 },
            { label: 'SP8', color: CLASS_COLORS.SP8 },
            { label: 'SP9', color: CLASS_COLORS.SP9 },
            { label: 'SP10', color: CLASS_COLORS.SP10 },
            { label: 'AT', color: CLASS_COLORS.AT },
            { label: 'CUP', color: CLASS_COLORS.CUP },
            { label: 'H2', color: CLASS_COLORS.H2 },
            { label: 'H4', color: CLASS_COLORS.H4 }
        ];
        
        for (const item of classGroups) {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '4px';
            
            const dot = document.createElement('span');
            dot.style.width = '8px';
            dot.style.height = '8px';
            dot.style.borderRadius = '50%';
            dot.style.backgroundColor = item.color;
            dot.style.flexShrink = '0';
            
            const label = document.createElement('span');
            label.textContent = item.label;
            label.style.whiteSpace = 'nowrap';
            
            div.appendChild(dot);
            div.appendChild(label);
            legend.appendChild(div);
        }
        
        box.appendChild(header);
        box.appendChild(canvasWrapper);
        box.appendChild(legend);
        player.appendChild(box);

        state.mapBox = box;
        state.mapCanvas = canvas;
        state.mapCtx = canvas.getContext('2d');

        ensureTrackSvgData();

        // Setup window manager (draggable, resizable, hideable)
        NLS.setupWindow(box, header, 'track_map', 300, 300);

        // Add mouse move listener for hover tooltips
        setupCanvasInteraction(canvas);

        return box;
    }

    /**
     * Setup canvas interaction (hover tooltips, click selection)
     */
    function setupCanvasInteraction(canvas) {
        const tooltip = document.createElement('div');
        tooltip.style.position = 'fixed';
        tooltip.style.background = 'rgba(0,0,0,0.9)';
        tooltip.style.color = '#fff';
        tooltip.style.padding = '6px 10px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.fontSize = '11px';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.zIndex = '10000';
        tooltip.style.display = 'none';
        tooltip.style.whiteSpace = 'pre-wrap';
        tooltip.style.maxWidth = '250px';
        tooltip.style.lineHeight = '1.4';
        tooltip.style.border = '1px solid rgba(255,255,255,0.2)';
        document.body.appendChild(tooltip);

        state.mapTooltip = tooltip;
        state.mapHoveredMarker = null;
        state.mapHoveredCar = null;

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
            const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);

            let hoveredItem = null;
            let hoveredText = '';

            // Check if hovering over markers
            if (state.mapMarkers) {
                for (const marker of state.mapMarkers) {
                    const dx = canvasX - marker.x;
                    const dy = canvasY - marker.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist <= 8) {
                        hoveredItem = marker;
                        hoveredText = marker.tooltip;
                        break;
                    }
                }
            }

            // Check if hovering over cars
            if (!hoveredItem && state.mapCars) {
                for (const car of state.mapCars) {
                    const dx = canvasX - car.x;
                    const dy = canvasY - car.y;
                    const dist = Math.hypot(dx, dy);
                    const hoverRadius = car.isSelected ? car.radius + 3 : car.radius + 2;
                    if (dist <= hoverRadius) {
                        hoveredItem = car;
                        hoveredText = car.tooltip;
                        break;
                    }
                }
            }

            state.mapHoveredMarker = hoveredItem?.type === 'marker' ? hoveredItem : null;
            state.mapHoveredCar = hoveredItem?.type === 'car' ? hoveredItem : null;
            canvas.style.cursor = hoveredItem ? 'pointer' : 'default';

            // Show/hide tooltip
            if (hoveredText) {
                tooltip.textContent = hoveredText;
                tooltip.style.display = 'block';
                tooltip.style.left = (e.clientX + 8) + 'px';
                tooltip.style.top = (e.clientY + 8) + 'px';
            } else {
                tooltip.style.display = 'none';
            }
        });

        canvas.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            state.mapHoveredMarker = null;
            state.mapHoveredCar = null;
            canvas.style.cursor = 'default';
        });

        canvas.addEventListener('click', (e) => {
            if (state.mapHoveredCar) {
                state.selectedStartNumber = state.mapHoveredCar.stnr;
                if (state.relInput) state.relInput.value = state.selectedStartNumber;
                NLS.renderRelative();
                renderTrackMap();

                // Show speed profile for this car
                const car = state.cars.find(c => NLS.normalizeText(c.STNR) === state.mapHoveredCar.stnr);
                if (car && NLS.showSpeedProfile) {
                    NLS.showSpeedProfile(car);
                }
            }
        });
    }


    /**
     * Fetch track SVG and extract SVG path data for rendering
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
                const pathMatch = svgText.match(/<path[^>]*\sd=["']([^"']+)["'][^>]*>/i);
                if (!pathMatch) return;

                state.mapSvgData = { d: pathMatch[1] || '' };
                state.mapPathData = null; // Reset parsed path
                NLS.log('Track map SVG loaded');
            })
            .catch((error) => {
                NLS.log('Track map load failed', error);
            })
            .finally(() => {
                state.mapSvgLoading = false;
            });
    }

    /**
     * Parse SVG path string into movable commands and segments
     * Converts SVG path format to drawable line segments
     */
    function parseSvgPath(pathString) {
        if (!pathString) return [];

        const segments = [];
        let currentPoint = { x: 0, y: 0 };
        
        // Parse SVG path commands (M=move, L=line, H=horizontal, V=vertical, C=cubic bezier, Z=close)
        const commandRegex = /([MmLlHhVvCcSsQqTtAaZz])|(-?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/g;
        const matches = [...pathString.matchAll(commandRegex)];

        let i = 0;
        while (i < matches.length) {
            const cmdMatch = matches[i];
            const cmd = cmdMatch[0];

            if (!cmd.match(/[A-Za-z]/)) {
                i++;
                continue;
            }

            const isRelative = cmd === cmd.toLowerCase() && cmd !== 'M';
            const cmdUpper = cmd.toUpperCase();

            // Helper to get next numbers
            const getNumbers = (count) => {
                const nums = [];
                while (nums.length < count && i + 1 < matches.length) {
                    i++;
                    const m = matches[i];
                    if (m[1]) break; // Hit next command
                    const num = parseFloat(m[0]);
                    if (!isNaN(num)) nums.push(num);
                }
                return nums;
            };

            switch (cmdUpper) {
                case 'M': {
                    const nums = getNumbers(2);
                    if (nums.length >= 2) {
                        const p = {
                            x: isRelative ? currentPoint.x + nums[0] : nums[0],
                            y: isRelative ? currentPoint.y + nums[1] : nums[1]
                        };
                        currentPoint = p;
                        segments.push({ type: 'M', point: p });
                    }
                    break;
                }
                case 'L': {
                    const nums = getNumbers(2);
                    if (nums.length >= 2) {
                        const p = {
                            x: isRelative ? currentPoint.x + nums[0] : nums[0],
                            y: isRelative ? currentPoint.y + nums[1] : nums[1]
                        };
                        segments.push({ type: 'L', from: currentPoint, to: p });
                        currentPoint = p;
                    }
                    break;
                }
                case 'H': {
                    const nums = getNumbers(1);
                    if (nums.length >= 1) {
                        const x = isRelative ? currentPoint.x + nums[0] : nums[0];
                        const p = { x, y: currentPoint.y };
                        segments.push({ type: 'L', from: currentPoint, to: p });
                        currentPoint = p;
                    }
                    break;
                }
                case 'V': {
                    const nums = getNumbers(1);
                    if (nums.length >= 1) {
                        const y = isRelative ? currentPoint.y + nums[0] : nums[0];
                        const p = { x: currentPoint.x, y };
                        segments.push({ type: 'L', from: currentPoint, to: p });
                        currentPoint = p;
                    }
                    break;
                }
                case 'C': {
                    const nums = getNumbers(6);
                    if (nums.length >= 6) {
                        const cp1 = {
                            x: isRelative ? currentPoint.x + nums[0] : nums[0],
                            y: isRelative ? currentPoint.y + nums[1] : nums[1]
                        };
                        const cp2 = {
                            x: isRelative ? currentPoint.x + nums[2] : nums[2],
                            y: isRelative ? currentPoint.y + nums[3] : nums[3]
                        };
                        const p = {
                            x: isRelative ? currentPoint.x + nums[4] : nums[4],
                            y: isRelative ? currentPoint.y + nums[5] : nums[5]
                        };
                        segments.push({ type: 'C', from: currentPoint, cp1, cp2, to: p });
                        currentPoint = p;
                    }
                    break;
                }
                case 'Z': {
                    segments.push({ type: 'Z' });
                    break;
                }
                default:
                    i++;
            }
            i++;
        }

        return segments;
    }

    /**
     * Convert parsed SVG path segments to drawable points with distances
     */
    function buildPathFromSegments(segments) {
        const points = [];
        let totalDist = 0;

        for (const seg of segments) {
            if (seg.type === 'M') {
                points.push({ ...seg.point, dist: totalDist });
            } else if (seg.type === 'L') {
                const dx = seg.to.x - seg.from.x;
                const dy = seg.to.y - seg.from.y;
                const dist = Math.hypot(dx, dy);
                totalDist += dist;
                points.push({ ...seg.to, dist: totalDist });
            } else if (seg.type === 'C') {
                // Subdivide cubic bezier with adaptive sampling
                const steps = Math.ceil(Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y) / 2);
                for (let t = 0; t <= 1; t += 1 / Math.max(1, steps)) {
                    const mt = 1 - t;
                    const x = mt * mt * mt * seg.from.x + 3 * mt * mt * t * seg.cp1.x + 3 * mt * t * t * seg.cp2.x + t * t * t * seg.to.x;
                    const y = mt * mt * mt * seg.from.y + 3 * mt * mt * t * seg.cp1.y + 3 * mt * t * t * seg.cp2.y + t * t * t * seg.to.y;
                    const dx = x - (points[points.length - 1]?.x ?? 0);
                    const dy = y - (points[points.length - 1]?.y ?? 0);
                    const dist = Math.hypot(dx, dy);
                    totalDist += dist;
                    points.push({ x, y, dist: totalDist });
                }
            }
        }

        return { points, totalDist };
    }

    /**
     * Get point on path at given distance
     */
    function getPointAtDistance(pathData, targetDist) {
        if (!pathData || pathData.points.length === 0) return null;
        
        const clamped = NLS.clamp(targetDist, 0, pathData.totalDist);
        
        // Binary search
        let left = 0, right = pathData.points.length - 1;
        while (left < right - 1) {
            const mid = Math.floor((left + right) / 2);
            if (pathData.points[mid].dist <= clamped) {
                left = mid;
            } else {
                right = mid;
            }
        }

        const p1 = pathData.points[left];
        const p2 = pathData.points[right];

        if (p1.dist === p2.dist) return p1;

        const t = (clamped - p1.dist) / (p2.dist - p1.dist);
        return {
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t,
            dist: clamped
        };
    }

    /**
     * Draw track on canvas with simple gray coloring
     */
    function drawTrack(ctx, pathData) {
        if (!pathData) return;

        // Draw track segments in simple gray
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(100, 100, 100, 0.6)';
        ctx.globalAlpha = 0.9;

        const points = pathData.points;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            if (i === 0) {
                ctx.moveTo(points[i].x, points[i].y);
            } else {
                ctx.lineTo(points[i].x, points[i].y);
            }
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    /**
     * Get perpendicular direction at a point on path
     */
    function getPerpendicularDirection(pathData, dist) {
        const p1 = getPointAtDistance(pathData, dist);
        const p2 = getPointAtDistance(pathData, dist + 1);
        if (!p1 || !p2) return null;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        return { nx: -dy / len, ny: dx / len };
    }

    /**
     * Draw marker (perpendicular line at track distance)
     */
    function drawMarker(ctx, pathData, dist, color, width, size) {
        const p1 = getPointAtDistance(pathData, dist);
        if (!p1) return;

        const perp = getPerpendicularDirection(pathData, dist);
        if (!perp) return;

        const half = size / 2;
        const x1 = p1.x - perp.nx * half;
        const y1 = p1.y - perp.ny * half;
        const x2 = p1.x + perp.nx * half;
        const y2 = p1.y + perp.ny * half;

        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Store marker for hit detection
        if (!state.mapMarkers) state.mapMarkers = [];
        state.mapMarkers.push({
            type: 'marker',
            x: p1.x,
            y: p1.y,
            radius: size / 2,
            tooltip: ''
        });
    }

    /**
     * Get class color for a car
     */
    function classColor(className) {
        const text = NLS.normalizeText(className).toUpperCase();
        const key = text.replace(/[^A-Z0-9]/g, '');
        const prefixMatch = key.match(/^[A-Z]+\d+/);
        const prefix = prefixMatch ? prefixMatch[0] : key;

        if (CLASS_COLORS[prefix]) return CLASS_COLORS[prefix];
        if (CLASS_COLORS[key]) return CLASS_COLORS[key];
        return '#cbd5f5';
    }

    /**
     * Main track map render function
     */
    function renderTrackMap() {
        const canvas = state.mapCanvas;
        const ctx = state.mapCtx;

        if (!canvas || !ctx || !state.latestPayload) return;

        const model = NLS.getTrackModel(state.latestPayload);
        if (!model) return;

        // Parse SVG path on first render
        if (!state.mapPathData && state.mapSvgData) {
            const segments = parseSvgPath(state.mapSvgData.d);
            state.mapPathData = buildPathFromSegments(segments);
        }

        if (!state.mapPathData) return;

        // Clear canvas
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const pathData = state.mapPathData;
        const pathLength = pathData.totalDist;
        const selected = state.selectedStartNumber.trim();

        // Draw track with curvature coloring
        drawTrack(ctx, pathData);

        // Clear and rebuild marker/car lists
        state.mapMarkers = [];
        state.mapCars = [];

        // Draw start/finish marker
        drawMarker(ctx, pathData, 0, 'rgba(0,255,100,0.8)', 3, 26);
        if (state.mapMarkers.length > 0) {
            state.mapMarkers[state.mapMarkers.length - 1].tooltip = 'START/FINISH';
        }

        // Draw sector markers
        model.cumulative.forEach((distance, idx) => {
            const fraction = distance / model.trackLength;
            const sectorNum = idx + 1;
            const markerDist = fraction * pathLength;
            drawMarker(ctx, pathData, markerDist, 'rgba(100,180,255,0.7)', 2.5, 20);
            if (state.mapMarkers.length > 0) {
                state.mapMarkers[state.mapMarkers.length - 1].tooltip = `Sector ${sectorNum} End`;
            }
        });

        // Draw car dots
        state.cars.forEach(car => {
            const progress = NLS.getCarProgress(car);
            if (!progress || !Number.isFinite(progress.lapDistance)) return;

            const fraction = progress.lapDistance / model.trackLength;
            if (!Number.isFinite(fraction)) return;

            const point = getPointAtDistance(pathData, NLS.clamp(fraction, 0, 1) * pathLength);
            if (!point) return;

            const isSelected = NLS.normalizeText(car.STNR) === selected;
            const color = classColor(car.CLASSNAME);
            const baseSize = NLS.clamp(Number(state.dotSize) || NLS.CONFIG.defaultDotSize, 1, 10);
            const radius = isSelected ? baseSize + 1 : baseSize;

            // Draw halo for selected car
            if (isSelected) {
                ctx.strokeStyle = '#22c55e';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius + 2, 0, 2 * Math.PI);
                ctx.stroke();
            }

            // Draw dot
            ctx.fillStyle = color;
            ctx.strokeStyle = isSelected ? '#22c55e' : 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            // Build car info for hit detection and tooltip
            const speedKmh = (progress.speedMps * 3.6).toFixed(1);
            const lapNum = NLS.toNumber(car.LAPS) ?? 0;
            const distanceKm = (progress.lapDistance / 1000).toFixed(2);
            const className = NLS.normalizeText(car.CLASSNAME);
            const stnr = NLS.normalizeText(car.STNR);

            let tooltipText = `#${stnr} - ${className}\n`;
            tooltipText += `Lap ${lapNum}\n`;
            tooltipText += `Distance: ${distanceKm}km\n`;
            tooltipText += `Speed: ${speedKmh}km/h`;

            state.mapCars.push({
                type: 'car',
                x: point.x,
                y: point.y,
                radius,
                isSelected,
                stnr,
                tooltip: tooltipText
            });
        });
    }

    NLS.ensureTrackMap = ensureTrackMap;
    NLS.renderTrackMap = renderTrackMap;
    NLS.getPathTotalLength = () => state.mapPathData?.totalDist || 0;
})();
