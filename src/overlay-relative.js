(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { REL_BOX_ID } = NLS.IDS;

    /**
     * Ensure the relative timing overlay exists and is attached.
     * @returns {HTMLDivElement|null}
     */
    function ensureRelativeOverlay() {
        let box = document.getElementById(REL_BOX_ID);
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
        box.id = REL_BOX_ID;
        box.style.position = 'absolute';
        box.style.left = '10px';
        box.style.bottom = '10px';
        box.style.zIndex = '9999';
        box.style.background = 'rgba(0,0,0,0.88)';
        box.style.color = '#fff';
        box.style.padding = '8px';
        box.style.minWidth = '760px';
        box.style.maxWidth = '860px';
        box.style.fontFamily = 'Arial, sans-serif';
        box.style.fontSize = '11px';
        box.style.pointerEvents = 'auto';
        box.style.borderRadius = '6px';
        box.style.boxSizing = 'border-box';

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.justifyContent = 'space-between';
        topRow.style.marginBottom = '6px';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.gap = '12px';
        header.style.flex = '1';

        const status = document.createElement('div');
        status.style.fontSize = '12px';
        status.style.fontWeight = '700';
        status.textContent = 'Relative timing';

        const estimateStatus = document.createElement('span');
        estimateStatus.style.marginLeft = '8px';
        estimateStatus.style.fontSize = '10px';
        estimateStatus.style.fontWeight = '400';
        estimateStatus.style.opacity = '0.85';
        estimateStatus.style.display = 'none';
        status.appendChild(estimateStatus);

        header.appendChild(status);

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.alignItems = 'center';
        controls.style.gap = '6px';
        controls.style.pointerEvents = 'auto';

        const label = document.createElement('span');
        label.textContent = 'Start #';
        label.style.fontSize = '11px';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = state.selectedStartNumber;
        input.style.width = '70px';
        input.style.padding = '2px 4px';
        input.style.fontSize = '11px';
        input.style.border = '1px solid rgba(255,255,255,0.25)';
        input.style.borderRadius = '4px';
        input.style.background = 'rgba(255,255,255,0.08)';
        input.style.color = '#fff';
        input.style.pointerEvents = 'auto';

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

        input.addEventListener('keydown', stopPlayerShortcutsAndDefaultForSpace, true);
        input.addEventListener('keypress', stopPlayerShortcuts, true);
        input.addEventListener('keyup', stopPlayerShortcuts, true);

        controls.addEventListener('keydown', stopPlayerShortcutsAndDefaultForSpace, true);
        controls.addEventListener('keypress', stopPlayerShortcuts, true);
        controls.addEventListener('keyup', stopPlayerShortcuts, true);

        input.addEventListener('input', () => {
            state.selectedStartNumber = input.value.trim();
            renderRelative();
        });

        controls.appendChild(label);
        controls.appendChild(input);
        topRow.appendChild(header);
        topRow.appendChild(controls);

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.tableLayout = 'fixed';
        table.style.fontSize = '11px';

        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        const headers = ['P', '#', 'Driver', 'Car', 'Class', 'Lap', 'Prog', 'Spd', 'Rel'];

        headers.forEach((h, i) => {
            const th = document.createElement('th');
            th.textContent = h;
            th.style.background = 'rgba(255,255,255,0.08)';
            th.style.padding = '4px 6px';
            th.style.textAlign = i >= 5 ? 'right' : 'left';
            th.style.borderBottom = '1px solid rgba(255,255,255,0.15)';

            if (i === 0) th.style.width = '24px';
            if (i === 1) th.style.width = '34px';
            if (i === 4) th.style.width = '70px';
            if (i === 5) th.style.width = '44px';
            if (i === 6) th.style.width = '56px';
            if (i === 7) th.style.width = '64px';
            if (i === 8) th.style.width = '76px';

            tr.appendChild(th);
        });

        thead.appendChild(tr);

        const tbody = document.createElement('tbody');
        table.appendChild(thead);
        table.appendChild(tbody);

        box.appendChild(topRow);
        box.appendChild(table);
        player.appendChild(box);

        state.relStatus = status;
        state.relEstimateStatus = estimateStatus;
        state.relInput = input;
        state.relTbody = tbody;

        // Setup window manager (draggable, resizable, hideable)
        NLS.setupWindow(box, header, 'relative_timing', 760, 300);

        return box;
    }

    /**
     * Format the relative gap text for fallback mode.
     * @param {Record<string, unknown>} selectedCar
     * @param {Record<string, unknown>} otherCar
     * @param {number} selectedIndex
     * @param {number} otherIndex
     * @returns {string}
     */
    function formatRelativeValue(selectedCar, otherCar, selectedIndex, otherIndex) {
        if (selectedIndex === otherIndex) {
            return '0.000';
        }

        const selectedLaps = Number(selectedCar.LAPS);
        const otherLaps = Number(otherCar.LAPS);

        const selectedGap = NLS.parseGapSeconds(selectedCar.GAP);
        const otherGap = NLS.parseGapSeconds(otherCar.GAP);

        const lapsKnown = Number.isFinite(selectedLaps) && Number.isFinite(otherLaps);
        const gapKnown = selectedGap !== null && otherGap !== null;

        const lapDelta = lapsKnown ? (otherLaps - selectedLaps) : 0;

        if (lapDelta === 0 && gapKnown) {
            const rel = selectedGap - otherGap;
            const sign = rel > 0 ? '+' : '';
            return `${sign}${rel.toFixed(3)}`;
        }

        if (lapDelta !== 0) {
            let out = `${lapDelta > 0 ? '+' : ''}${lapDelta}L`;

            if (gapKnown) {
                const rel = selectedGap - otherGap;
                const sign = rel > 0 ? '+' : '';
                out += ` ${sign}${rel.toFixed(3)}`;
            }

            return out;
        }

        const selectedGapLap = NLS.parseGapLapNumber(selectedCar.GAP);
        const otherGapLap = NLS.parseGapLapNumber(otherCar.GAP);
        const leaderLap = Number.isFinite(state.leaderLap) ? state.leaderLap : null;

        if (Number.isFinite(selectedGapLap) || Number.isFinite(otherGapLap) || Number.isFinite(leaderLap)) {
            if (Number.isFinite(selectedLaps) && Number.isFinite(otherLaps)) {
                const delta = otherLaps - selectedLaps;
                return `${delta > 0 ? '+' : ''}${delta}L`;
            }
        }

        return otherIndex < selectedIndex ? '+?' : '-?';
    }

    /**
     * Render the relative timing table around the selected car.
     */
    function renderRelative() {
        if (!NLS.matches()) return;
        if (!state.relTbody) return;

        state.relTbody.replaceChildren();

        if (!state.cars.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 9;
            td.textContent = 'No timing data received yet.';
            td.style.padding = '6px';
            tr.appendChild(td);
            state.relTbody.appendChild(tr);
            return;
        }

        if (state.relEstimateStatus && !state.relEstimateCompleted) {
            const eligibleCars = state.cars.filter(car => !NLS.isRetired(car));
            const total = eligibleCars.length;
            const updated = eligibleCars.filter(car => state.timingUpdated.has(NLS.normalizeText(car.STNR))).length;
            const percent = total > 0 ? Math.round((updated / total) * 100) : 0;

            if (percent >= 100) {
                state.relEstimateStatus.textContent = 'done';
                state.relEstimateStatus.style.color = '#22c55e';
                state.relEstimateStatus.style.display = 'inline';
                state.relEstimateCompleted = true;
                window.setTimeout(() => {
                    if (state.relEstimateStatus) {
                        state.relEstimateStatus.style.display = 'none';
                        state.relEstimateStatus.textContent = '';
                    }
                }, 1800);
            } else {
                state.relEstimateStatus.textContent = `Estimating... : ${percent}%`;
                state.relEstimateStatus.style.color = '#fff';
                state.relEstimateStatus.style.display = 'inline';
            }
        }

        const selected = state.selectedStartNumber.trim();
        const selectedIndex = state.cars.findIndex(c => NLS.normalizeText(c.STNR) === selected);

        if (selectedIndex < 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 9;
            td.textContent = selected ? `Start number ${selected} not found.` : 'Enter a start number.';
            td.style.padding = '6px';
            tr.appendChild(td);
            state.relTbody.appendChild(tr);
            return;
        }

        const selectedCar = state.cars[selectedIndex];
        const selectedLaps = NLS.toNumber(selectedCar.LAPS);
        const trackModel = NLS.getTrackModel(state.latestPayload);
        const serverNowMs = NLS.getServerNowMs();
        const selectedProgress = NLS.computeCarProgress(selectedCar, trackModel, serverNowMs);

        /**
         * Apply row background for lap deltas and selection highlight.
         * @param {HTMLTableRowElement} row
         * @param {Record<string, unknown>} car
         * @param {number} globalIndex
         * @returns {string|null}
         */
        function applyRelativeRowBackground(row, car, globalIndex) {
            if (globalIndex === selectedIndex) {
                row.style.background = 'rgba(34,197,94,0.18)';
                return 'rgba(34,197,94,0.18)';
            }

            const carLaps = NLS.toNumber(car.LAPS);
            if (Number.isFinite(selectedLaps) && Number.isFinite(carLaps)) {
                if (carLaps < selectedLaps) {
                    row.style.background = 'rgba(59,130,246,0.2)';
                    return 'rgba(59,130,246,0.2)';
                }
                if (carLaps > selectedLaps) {
                    row.style.background = 'rgba(239,68,68,0.2)';
                    return 'rgba(239,68,68,0.2)';
                }
            }

            if (globalIndex % 2 === 0) {
                row.style.background = 'rgba(255,255,255,0.02)';
                return 'rgba(255,255,255,0.02)';
            }

            return null;
        }

        /**
         * Apply a shared background to every cell in a row.
         * @param {HTMLTableCellElement[]} cells
         * @param {string|null} bg
         */
        function applyCellBackground(cells, bg) {
            if (!bg) return;
            cells.forEach(cell => {
                cell.style.background = bg;
            });
        }

        // Fallback when we cannot compute progress for relative positioning.
        if (!trackModel || !selectedProgress) {
            const start = Math.max(0, selectedIndex - NLS.CONFIG.relativeRowsBefore);
            const end = Math.min(state.cars.length, selectedIndex + NLS.CONFIG.relativeRowsAfter + 1);
            const rows = state.cars.slice(start, end);

            rows.forEach((car, localIndex) => {
                const globalIndex = start + localIndex;
                const tr = document.createElement('tr');

                const rowBg = applyRelativeRowBackground(tr, car, globalIndex);

                const relValue = formatRelativeValue(selectedCar, car, selectedIndex, globalIndex);
                const relDisplay = relValue.includes('?') ? `~${relValue}` : relValue;

                const cells = [
                    NLS.makeCell(car.POSITION),
                    NLS.makeCell(car.STNR),
                    NLS.makeCell(car.NAME),
                    NLS.makeCell(car.CAR),
                    NLS.makeCell(car.CLASSNAME),
                    NLS.makeCell(car.LAPS, true),
                    NLS.makeCell('n/a', true),
                    NLS.makeCell(formatSpeedKph(null), true),
                    NLS.makeCell(relDisplay, true)
                ];

                if (globalIndex === selectedIndex) {
                    cells[0].style.fontWeight = '700';
                    cells[1].style.fontWeight = '700';
                    cells[2].style.fontWeight = '700';
                    cells[8].style.fontWeight = '700';
                    cells[8].style.color = '#22c55e';
                } else {
                    if (globalIndex < selectedIndex) {
                        cells[8].style.color = '#facc15';
                    } else {
                        cells[8].style.color = '#93c5fd';
                    }
                }

                applyCellBackground(cells, rowBg);
                cells.forEach(td => tr.appendChild(td));
                state.relTbody.appendChild(tr);
            });

            return;
        }

        /**
         * Compute signed shortest-path distance around the track.
         * @param {number} selectedDistance
         * @param {number} otherDistance
         * @param {number} trackLength
         * @returns {number|null}
         */
        function signedTrackDelta(selectedDistance, otherDistance, trackLength) {
            if (!Number.isFinite(selectedDistance) || !Number.isFinite(otherDistance)) return null;
            const raw = otherDistance - selectedDistance;
            const wrapped = ((raw + trackLength / 2) % trackLength + trackLength) % trackLength - trackLength / 2;
            return wrapped;
        }

        const entries = state.cars.map((car, index) => {
            const progressInfo = NLS.computeCarProgress(car, trackModel, serverNowMs);
            const deltaTrack = progressInfo
                ? signedTrackDelta(selectedProgress.lapDistance, progressInfo.lapDistance, trackModel.trackLength)
                : null;

            return {
                car,
                index,
                progressInfo,
                deltaTrack
            };
        });

        const ahead = entries
            .filter(entry => Number.isFinite(entry.deltaTrack) && entry.deltaTrack > 0)
            .sort((a, b) => a.deltaTrack - b.deltaTrack)
            .slice(0, NLS.CONFIG.relativeRowsAfter);

        const behind = entries
            .filter(entry => Number.isFinite(entry.deltaTrack) && entry.deltaTrack < 0)
            .sort((a, b) => b.deltaTrack - a.deltaTrack)
            .slice(0, NLS.CONFIG.relativeRowsBefore);

        const selectedEntry = entries.find(entry => entry.index === selectedIndex);
        const rows = [...ahead.slice().reverse(), selectedEntry, ...behind].filter(Boolean);

        /**
         * Rank cars by estimated progress for a temporary position map.
         * @param {{car: Record<string, unknown>, progressInfo: {progress:number}|null}[]} items
         * @returns {Map<string, number>}
         */
        function buildEstimatedPositionMap(items) {
            const ranked = items
                .filter(entry => Number.isFinite(entry.progressInfo?.progress))
                .slice()
                .sort((a, b) => {
                    const delta = b.progressInfo.progress - a.progressInfo.progress;
                    if (delta !== 0) return delta;
                    const posA = NLS.toNumber(a.car.POSITION) ?? Number.POSITIVE_INFINITY;
                    const posB = NLS.toNumber(b.car.POSITION) ?? Number.POSITIVE_INFINITY;
                    return posA - posB;
                });

            const map = new Map();
            ranked.forEach((entry, idx) => {
                map.set(NLS.normalizeText(entry.car.STNR), idx + 1);
            });

            return map;
        }

        /**
         * Decorate the position cell when estimated order differs from socket data.
         * @param {HTMLTableCellElement} cell
         * @param {Record<string, unknown>} car
         * @param {Map<string, number>} estimatedMap
         */
        function applyEstimatedPositionMarker(cell, car, estimatedMap) {
            const estPos = estimatedMap.get(NLS.normalizeText(car.STNR));
            const socketPos = NLS.toNumber(car.POSITION);
            if (!Number.isFinite(estPos)) return;

            cell.textContent = String(estPos);
            if (Number.isFinite(socketPos) && estPos !== socketPos) {
                cell.style.color = '#f59e0b';
                cell.style.fontWeight = '700';
                cell.title = `Socket pos: ${socketPos} (timing update pending)`;
            }
        }

        const estimatedPositionMap = buildEstimatedPositionMap(entries);

        /**
         * Format speed in km/h from progress data.
         * @param {{speedMps:number}|null} progressInfo
         * @returns {string}
         */
        function formatSpeedKph(progressInfo) {
            const speed = progressInfo?.speedMps;
            if (!Number.isFinite(speed) || speed <= 0) return 'n/a';
            return `${Math.round(speed * 3.6)} km/h`;
        }

        /**
         * Format lap progress percentage from progress data.
         * @param {{lapDistance:number}|null} progressInfo
         * @returns {string}
         */
        function formatProgressPercent(progressInfo) {
            if (!progressInfo) return 'n/a';
            const pct = (progressInfo.lapDistance / trackModel.trackLength) * 100;
            if (!Number.isFinite(pct)) return 'n/a';
            return `${pct.toFixed(1)}%`;
        }

        /**
         * Format a relative time estimate between two cars.
         * @param {number} distance
         * @param {{segmentDurationMs:number|null, segmentLength:number|null, speedMps:number}|null} selectedInfo
         * @param {{speedMps:number}|null} otherInfo
         * @param {boolean} isEstimate
         * @returns {string}
         */
        function formatRelativeTime(distance, selectedInfo, otherInfo, isEstimate) {
            if (!Number.isFinite(distance) || !selectedInfo) return 'n/a';
            const { segmentDurationMs, segmentLength } = selectedInfo;

            const selectedSpeed = selectedInfo?.speedMps;
            const otherSpeed = otherInfo?.speedMps;

            let speed = null;
            if (Number.isFinite(selectedSpeed) && Number.isFinite(otherSpeed)) {
                speed = (selectedSpeed + otherSpeed) / 2;
            } else if (Number.isFinite(selectedSpeed)) {
                speed = selectedSpeed;
            } else if (Number.isFinite(otherSpeed)) {
                speed = otherSpeed;
            } else if (Number.isFinite(segmentDurationMs) && Number.isFinite(segmentLength) && segmentDurationMs > 0 && segmentLength > 0) {
                speed = segmentLength / (segmentDurationMs / 1000);
            }

            if (!Number.isFinite(speed) || speed <= 0) return 'n/a';

            const seconds = distance / speed;
            const sign = distance > 0 ? '+' : '';
            const prefix = isEstimate ? '~' : '';

            return `${prefix}${sign}${Math.abs(seconds).toFixed(2)} s`;
        }

        rows.forEach((entry) => {
            const { car, index: globalIndex, progressInfo, deltaTrack } = entry;
            const tr = document.createElement('tr');

            const rowBg = applyRelativeRowBackground(tr, car, globalIndex);

            const isEstimate = Boolean(selectedProgress?.isExtrapolated || progressInfo?.isExtrapolated);
            const relValue = formatRelativeTime(deltaTrack, selectedProgress, progressInfo, isEstimate);
            const progressValue = formatProgressPercent(progressInfo);

            const cells = [
                NLS.makeCell(car.POSITION),
                NLS.makeCell(car.STNR),
                NLS.makeCell(car.NAME),
                NLS.makeCell(car.CAR),
                NLS.makeCell(car.CLASSNAME),
                NLS.makeCell(car.LAPS, true),
                NLS.makeCell(progressValue, true),
                NLS.makeCell(formatSpeedKph(progressInfo), true),
                NLS.makeCell(relValue, true)
            ];

            applyEstimatedPositionMarker(cells[0], car, estimatedPositionMap);

            if (globalIndex === selectedIndex) {
                cells[0].style.fontWeight = '700';
                cells[1].style.fontWeight = '700';
                cells[2].style.fontWeight = '700';
                cells[8].style.fontWeight = '700';
                cells[8].style.color = '#22c55e';
            } else if (Number.isFinite(deltaTrack)) {
                cells[8].style.color = deltaTrack > 0 ? '#facc15' : '#93c5fd';
            }

            applyCellBackground(cells, rowBg);
            cells.forEach(td => tr.appendChild(td));
            state.relTbody.appendChild(tr);
        });
    }

    NLS.ensureRelativeOverlay = ensureRelativeOverlay;
    NLS.renderRelative = renderRelative;
})();
