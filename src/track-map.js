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
        );
        trackPath.setAttribute('d', NLS.TRACK_PATH || '');

        const markers = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const dots = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        svg.appendChild(trackPath);
        svg.appendChild(markers);
        svg.appendChild(dots);
        box.appendChild(svg);

        player.appendChild(box);
        state.mapBox = box;
        state.mapSvg = svg;
        state.mapTrackPath = trackPath;
        state.mapDots = dots;
        state.mapMarkers = markers;

        return box;
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

        state.mapMarkers.replaceChildren();
        state.mapDots.replaceChildren();

        const pathLength = state.mapTrackPath.getTotalLength();
        if (!Number.isFinite(pathLength) || pathLength <= 0) return;

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
        function addMarkerAtLength(length, color, width, size) {
            const base = NLS.clamp(length, 0, pathLength);
            const p1 = state.mapTrackPath.getPointAtLength(base);
            const p2 = state.mapTrackPath.getPointAtLength(NLS.clamp(base + 1, 0, pathLength));
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const half = size / 2;
            const x1 = p1.x - nx * half;
            const y1 = p1.y - ny * half;
                trackPath.setAttribute('d', state.mapSvgData?.d || '');
            const y2 = p1.y + ny * half;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1.toFixed(2));
            line.setAttribute('y1', y1.toFixed(2));
            line.setAttribute('x2', x2.toFixed(2));
            line.setAttribute('y2', y2.toFixed(2));
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', width);
            line.setAttribute('stroke-linecap', 'round');
            state.mapMarkers.appendChild(line);
        }

        // Start/finish line.
        addMarkerAtLength(0, 'rgba(255,255,255,0.95)', '3', 26);

        // Timing sector markers.
                ensureTrackSvgData();
        model.cumulative.forEach((distance) => {
            const fraction = distance / model.trackLength;
            addMarkerAtLength(fraction * pathLength, 'rgba(255,255,255,0.35)', '1.5', 18);

            /**
             * Fetch the track map SVG and cache its path and viewbox data.
             */
            function ensureTrackSvgData() {
                if (state.mapSvgData || state.mapSvgLoading) return;
                const url = NLS.CONFIG.trackMapUrl;
                if (!url) return;

                state.mapSvgLoading = true;
                fetch(url)
                    .then(res => res.text())
                    .then((svgText) => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(svgText, 'image/svg+xml');
                        const svgEl = doc.querySelector('svg');
                        const pathEl = doc.querySelector('path');
                        if (!svgEl || !pathEl) return;

                        const d = pathEl.getAttribute('d') || '';
                        const viewBox = svgEl.getAttribute('viewBox');
                        const width = svgEl.getAttribute('width');
                        const height = svgEl.getAttribute('height');
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
                    })
                    .catch(() => {})
                    .finally(() => {
                        state.mapSvgLoading = false;
                    });
            }
        });

        state.cars.forEach(car => {
            const progress = NLS.computeCarProgress(car, model, serverNowMs);
            if (!progress) return;

            const fraction = progress.lapDistance / model.trackLength;
            const point = state.mapTrackPath.getPointAtLength(NLS.clamp(fraction, 0, 1) * pathLength);
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
                state.mapDots.appendChild(halo);
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
            dot.addEventListener('click', (event) => {
                event.stopPropagation();
                state.selectedStartNumber = NLS.normalizeText(car.STNR);
                if (state.relInput) state.relInput.value = state.selectedStartNumber;
                NLS.renderRelative();
                renderTrackMap();
            });
            state.mapDots.appendChild(dot);
        });
    }

    NLS.ensureTrackMap = ensureTrackMap;
    NLS.renderTrackMap = renderTrackMap;
})();
