(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;
    const { MAIN_BOX_ID } = NLS.IDS;

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
        box.style.minWidth = '980px';
        box.style.maxWidth = '1100px';
        box.style.fontFamily = 'Arial, sans-serif';
        box.style.fontSize = '11px';
        box.style.pointerEvents = 'auto';
        box.style.borderRadius = '6px';
        box.style.boxSizing = 'border-box';

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

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.tableLayout = 'fixed';
        table.style.fontSize = '11px';

        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        const headers = ['P', '#', 'Name', 'Car', 'Class', 'Gap', 'Best', 'Last', 'S1', 'S2', 'S3', 'S4', 'S5'];

        headers.forEach((h, i) => {
            const th = document.createElement('th');
            th.textContent = h;
            th.style.background = 'rgb(255, 0, 234)';
            th.style.padding = '4px 6px';
            th.style.textAlign = i >= 5 ? 'right' : 'left';
            th.style.borderBottom = '1px solid rgba(255,255,255,0.15)';

            if (i === 0) th.style.width = '24px';
            if (i === 1) th.style.width = '34px';
            if (i === 4) th.style.width = '70px';
            if (i === 5) th.style.width = '54px';
            if (i >= 6) th.style.width = '54px';

            tr.appendChild(th);
        });

        thead.appendChild(tr);

        const tbody = document.createElement('tbody');

        table.appendChild(thead);
        table.appendChild(tbody);

        box.appendChild(status);
        box.appendChild(meta);
        box.appendChild(table);
        player.appendChild(box);

        state.mainStatus = status;
        state.mainMeta = meta;
        state.mainTbody = tbody;

        return box;
    }

    /**
     * Render the main timing table with sector highlights.
     */
    function renderMain() {
        if (!NLS.matches()) return;
        if (!state.mainTbody) return;

        state.mainTbody.replaceChildren();

        const rows = state.cars.slice(0, NLS.CONFIG.maxRows);
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

            const lastLap = NLS.normalizeText(car.LASTLAPTIME);
            const bestLap = NLS.normalizeText(car.FASTESTLAP);
            if (lastLap && bestLap && lastLap === bestLap) {
                cells[7].style.color = '#22c55e';
                cells[7].style.fontWeight = '700';
            }

            ['S1TIME', 'S2TIME', 'S3TIME', 'S4TIME', 'S5TIME'].forEach((key, i) => {
                const best = sectorBest.get(key);
                if (!best) return;

                if (Number(car.STNR) === best.stnr && NLS.normalizeText(car[key]) === best.time) {
                    const td = cells[8 + i];
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
