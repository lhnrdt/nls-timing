(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { MAIN_BOX_ID } = NLS.IDS;
    
    // Add webkit scrollbar styles for Chrome/Safari
    if (!document.getElementById('nls_leaderboard_scrollbar_styles')) {
        const style = document.createElement('style');
        style.id = 'nls_leaderboard_scrollbar_styles';
        style.textContent = `
            #${MAIN_BOX_ID} > div:nth-child(4)::-webkit-scrollbar {
                width: 8px;
            }
            #${MAIN_BOX_ID} > div:nth-child(4)::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
            }
            #${MAIN_BOX_ID} > div:nth-child(4)::-webkit-scrollbar-thumb {
                background: rgba(150, 150, 150, 0.6);
                border-radius: 4px;
            }
            #${MAIN_BOX_ID} > div:nth-child(4)::-webkit-scrollbar-thumb:hover {
                background: rgba(180, 180, 180, 0.8);
            }
        `;
        document.head.appendChild(style);
    }
    
    // Initialize maxRows from localStorage or config
    if (!state.maxRows) {
        const stored = localStorage.getItem('nls_maxRows');
        state.maxRows = stored ? parseInt(stored, 10) : NLS.CONFIG.maxRows;
    }

    /**
     * Determine the start number of the overall best lap holder.
     * @returns {number|null}
     */
    function bestLapStnr() {
        if (Array.isArray(state.latestPayload?.BEST) && state.latestPayload.BEST.length >= 4) {
            const stnr = Number(state.latestPayload.BEST[3]?.[0]);
            return Number.isFinite(stnr) ? stnr : null;
        }

        const first = state.cars.find(c => Number.isFinite(NLS.parseTime(c.FASTESTLAP)));
        return first ? Number(c.STNR) : null;
    }

    /**
     * Build a map of best sector times keyed by sector name.
     * @returns {Map<string, {stnr:number, time:string}>}
     */
    function bestSectorMap() {
        const map = new Map();
        if (!Array.isArray(state.latestPayload?.BEST)) return map;

        state.latestPayload.BEST.forEach((entry, idx) => {
            if (!Array.isArray(entry) || entry.length < 2) return;
            map.set(`S${idx + 1}TIME`, {
                stnr: Number(entry[0]),
                time: NLS.normalizeText(entry[1])
            });
        });

        return map;
    }

    /**
     * Create a styled table cell for overlay tables.
     * @param {unknown} text
     * @param {boolean} [alignRight=false]
     * @returns {HTMLTableCellElement}
     */
    function makeCell(text, alignRight = false) {
        const td = document.createElement('td');
        td.textContent = NLS.normalizeText(text);
        td.style.padding = '3px 6px';
        td.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        td.style.whiteSpace = 'nowrap';
        td.style.overflow = 'hidden';
        td.style.textOverflow = 'ellipsis';
        td.style.textAlign = alignRight ? 'right' : 'left';
        if (alignRight) td.style.fontVariantNumeric = 'tabular-nums';
        return td;
    }

    /**
     * Ensure the main timing overlay exists and is attached.
     * @returns {HTMLDivElement|null}
     */
    function ensureMainOverlay() {
        let box = document.getElementById(MAIN_BOX_ID);
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
        box.id = MAIN_BOX_ID;
        box.style.position = 'absolute';
        box.style.top = '10px';
        box.style.left = '10px';
        box.style.zIndex = '9999';
        box.style.background = 'rgba(0,0,0,0.88)';
        box.style.color = '#fff';
        box.style.padding = '8px';
        box.style.minWidth = '1200px';
        box.style.maxWidth = '1400px';
        box.style.maxHeight = '80vh';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.fontFamily = 'Arial, sans-serif';
        box.style.fontSize = '11px';
        box.style.pointerEvents = 'auto';
        box.style.borderRadius = '6px';
        box.style.boxSizing = 'border-box';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '6px';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = 'Leaderboard';
        titleSpan.style.fontWeight = 'bold';
        titleSpan.style.fontSize = '12px';
        header.appendChild(titleSpan);

        const maxRowsContainer = document.createElement('div');
        maxRowsContainer.style.marginLeft = '12px';
        maxRowsContainer.style.display = 'flex';
        maxRowsContainer.style.alignItems = 'center';
        maxRowsContainer.style.gap = '6px';

        const maxRowsLabel = document.createElement('label');
        maxRowsLabel.textContent = 'Show:';
        maxRowsLabel.style.fontSize = '11px';
        maxRowsLabel.style.opacity = '0.9';
        maxRowsContainer.appendChild(maxRowsLabel);

        const maxRowsInput = document.createElement('input');
        maxRowsInput.type = 'number';
        maxRowsInput.min = '1';
        maxRowsInput.max = '100';
        maxRowsInput.value = String(state.maxRows);
        maxRowsInput.style.width = '50px';
        maxRowsInput.style.padding = '2px 4px';
        maxRowsInput.style.fontSize = '11px';
        maxRowsInput.style.background = 'rgba(255,255,255,0.1)';
        maxRowsInput.style.color = '#fff';
        maxRowsInput.style.border = '1px solid rgba(255,255,255,0.2)';
        maxRowsInput.style.borderRadius = '3px';
        maxRowsInput.addEventListener('change', (e) => {
            const val = Math.min(100, Math.max(1, parseInt(e.target.value, 10) || NLS.CONFIG.maxRows));
            state.maxRows = val;
            localStorage.setItem('nls_maxRows', String(val));
            NLS.renderMain();
        });
        maxRowsContainer.appendChild(maxRowsInput);
        header.appendChild(maxRowsContainer);

        const status = document.createElement('div');
        status.style.fontSize = '12px';
        status.style.fontWeight = '700';
        status.style.marginBottom = '2px';
        status.textContent = 'Status: initializing...';

        const meta = document.createElement('div');
        meta.style.fontSize = '10px';
        meta.style.opacity = '0.8';
        meta.style.marginBottom = '6px';
        meta.textContent = 'waiting...';

        const tableWrapper = document.createElement('div');
        tableWrapper.style.overflowY = 'auto';
        tableWrapper.style.overflowX = 'hidden';
        tableWrapper.style.flex = '1';
        tableWrapper.style.scrollbarColor = 'rgba(150,150,150,0.6) rgba(0,0,0,0.2)';
        tableWrapper.style.scrollbarWidth = 'thin';

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.tableLayout = 'auto';
        table.style.fontSize = '11px';

        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        const headers = ['P', '#', 'Name', 'Car', 'Class', 'Gap', 'Best', 'Last', 'S1', 'S2', 'S3', 'S4', 'S5'];

        headers.forEach((h, i) => {
            const th = document.createElement('th');
            th.textContent = h;
            th.style.background = 'rgba(100, 100, 100, 0.5)';
            th.style.padding = '4px 6px';
            th.style.textAlign = i >= 5 ? 'right' : 'left';
            th.style.borderBottom = '1px solid rgba(255,255,255,0.15)';
            th.style.whiteSpace = 'nowrap';

            tr.appendChild(th);
        });

        thead.appendChild(tr);

        const tbody = document.createElement('tbody');

        table.appendChild(thead);
        table.appendChild(tbody);
        tableWrapper.appendChild(table);

        box.appendChild(header);
        box.appendChild(status);
        box.appendChild(meta);
        box.appendChild(tableWrapper);
        player.appendChild(box);

        state.mainStatus = status;
        state.mainMeta = meta;
        state.mainTbody = tbody;

        // Setup window manager (draggable, resizable, hideable)
        NLS.setupWindow(box, header, 'main_leaderboard', 980, 300);

        return box;
    }

    /**
     * Render the main timing table with sector highlights.
     */
    function renderMain() {
        if (!NLS.matches()) return;
        if (!state.mainTbody) return;

        state.mainTbody.replaceChildren();

        const rows = state.cars.slice(0, state.maxRows);
        if (!rows.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 13;
            td.textContent = 'No timing data received yet.';
            td.style.padding = '6px';
            tr.appendChild(td);
            state.mainTbody.appendChild(tr);
            return;
        }

        const overallBestStnr = bestLapStnr();
        const overallBestLap = state.latestPayload?.BEST?.[4] ? NLS.normalizeText(state.latestPayload.BEST[4]) : null;
        const sectorBest = bestSectorMap();

        rows.forEach((car, idx) => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';

            if (idx % 2 === 0) {
                tr.style.background = 'rgba(255,255,255,0.02)';
            }

            if (Number(car.STNR) === overallBestStnr) {
                tr.style.background = 'rgba(138,59,252,0.18)';
            }

            const cells = [
                makeCell(car.POSITION),
                makeCell(car.STNR),
                makeCell(car.NAME),
                makeCell(car.CAR),
                makeCell(car.CLASSNAME),
                makeCell(car.GAP, true),
                makeCell(car.FASTESTLAP, true),
                makeCell(car.LASTLAPTIME, true),
                makeCell(car.S1TIME, true),
                makeCell(car.S2TIME, true),
                makeCell(car.S3TIME, true),
                makeCell(car.S4TIME, true),
                makeCell(car.S5TIME, true)
            ];

            cells[0].style.fontWeight = '700';
            cells[1].style.fontWeight = '700';

            // Highlight the fastest lap cell (cells[6]) if it matches the overall best time
            const carBestLap = NLS.normalizeText(car.FASTESTLAP);
            if (carBestLap && overallBestLap && carBestLap === overallBestLap) {
                cells[6].style.color = '#22c55e';
                cells[6].style.fontWeight = '700';
                cells[6].style.background = 'rgba(34,197,94,0.08)';
            }

            ['S1TIME', 'S2TIME', 'S3TIME', 'S4TIME', 'S5TIME'].forEach((key, i) => {
                const best = sectorBest.get(key);
                if (!best) return;

                if (Number(car.STNR) === best.stnr && NLS.normalizeText(car[key]) === best.time) {
                    const td = cells[10 + i];
                    td.style.color = '#22c55e';
                    td.style.fontWeight = '700';
                    td.style.background = 'rgba(34,197,94,0.08)';
                }
            });

            cells.forEach(td => tr.appendChild(td));
            tr.addEventListener('click', (event) => {
                event.stopPropagation();
                state.selectedStartNumber = NLS.normalizeText(car.STNR);
                if (state.relInput) state.relInput.value = state.selectedStartNumber;
                NLS.renderRelative();
                NLS.renderTrackMap();
            });
            state.mainTbody.appendChild(tr);
        });
    }

    NLS.ensureMainOverlay = ensureMainOverlay;
    NLS.renderMain = renderMain;
    NLS.makeCell = makeCell;
})();
