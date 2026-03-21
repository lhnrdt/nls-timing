// ==UserScript==
// @name         YT NLS Stable Table + Relative Window 20260321
// @namespace    clean.test.local
// @version      1.1
// @description  Stable gated NLS overlay with relative timing window
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self || location.pathname.includes('/live_chat')) {
        return;
    }

    const MAIN_BOX_ID = 'yt-nls-main-box-20260321';
    const REL_BOX_ID = 'yt-nls-rel-box-20260321';
    const MAP_BOX_ID = 'yt-nls-track-map-20260321';
    const SETTINGS_BOX_ID = 'yt-nls-settings-box-20260321';
    const SETTINGS_TOGGLE_ID = 'yt-nls-settings-toggle-20260321';

    const MATCH = {
        channel: 'Nürburgring',
        titleContains: 'ADAC RAVENOL Nürburgring Langstrecken-Serie'
    };

    const CONFIG = {
        wsUrl: 'wss://livetiming.azurewebsites.net/',
        eventId: '20',
        eventPid: [0, 4],
        maxRows: 10,
        relativeRowsBefore: 3,
        relativeRowsAfter: 3,
        relativeUpdateMs: 250,
        defaultStartNumber: '911',
        defaultDelayMs: 4000,
        defaultDotSize: 5,
    };

    const state = {
        ws: null,
        cars: [],
        latestPayload: null,
        timeOffsetMs: 0,
        carKinematics: new Map(),
        leaderLap: null,

        mainTbody: null,
        mainStatus: null,
        mainMeta: null,

        relTbody: null,
        relStatus: null,
        relEstimateStatus: null,
        relEstimateCompleted: false,
        relInput: null,

        timingInit: new Map(),
        timingUpdated: new Set(),

        mapBox: null,
        mapSvg: null,
        mapTrackPath: null,
        mapDots: null,
        mapMarkers: null,

        settingsBox: null,
        settingsToggle: null,
        settingsOpen: false,
        delayMs: CONFIG.defaultDelayMs,
        dotSize: CONFIG.defaultDotSize,

        initialSelectionDone: false,
        selectedStartNumber: CONFIG.defaultStartNumber,
    };

    function normalizeText(t) {
        return String(t ?? '').replace(/\s+/g, ' ').trim();
    }

    function getTitle() {
        const selectors = [
            'ytd-watch-metadata h1 yt-formatted-string',
            '#title h1 yt-formatted-string',
            'meta[property="og:title"]',
            'title'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;

            let text = '';
            if (selector === 'meta[property="og:title"]') {
                text = normalizeText(el.getAttribute('content'));
            } else {
                text = normalizeText(el.textContent);
            }

            if (text) {
                return text.replace(/\s*-\s*YouTube\s*$/i, '').trim();
            }
        }

        return '';
    }

    function getChannel() {
        const selectors = [
            '#channel-name a',
            '#owner #channel-name a',
            'ytd-watch-metadata ytd-channel-name a',
            'ytd-video-owner-renderer a',
            'ytd-channel-name yt-formatted-string'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            const text = normalizeText(el?.textContent);
            if (text) return text;
        }

        return '';
    }

    function matches() {
        const title = getTitle();
        const channel = getChannel();

        return (
            channel === MATCH.channel &&
            title.includes(MATCH.titleContains)
        );
    }

    function getPlayerContainer() {
        return (
            document.getElementById('movie_player') ||
            document.querySelector('.html5-video-player') ||
            document.querySelector('#player')
        );
    }

    function parseTime(t) {
        const text = normalizeText(t);
        if (!text || text === 'PIT') return Number.POSITIVE_INFINITY;

        const parts = text.split(':').map(Number);
        if (parts.some(v => !Number.isFinite(v))) return Number.POSITIVE_INFINITY;

        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return Number.POSITIVE_INFINITY;
    }

    function parseGapSeconds(gapText) {
        const text = normalizeText(gapText);

        if (!text) return 0;
        if (text === '-' || text === '--') return null;
        if (/lap\s*\d+/i.test(text)) return null;

        if (/^\d+(\.\d+)?$/.test(text)) {
            return Number(text);
        }

        const timeVal = parseTime(text);
        if (Number.isFinite(timeVal)) return timeVal;

        return null;
    }

    function parseGapLapNumber(gapText) {
        const text = normalizeText(gapText);
        const match = text.match(/lap\s*(\d+)/i);
        return match ? Number(match[1]) : null;
    }

    function isRetired(car) {
        return ['S1TIME', 'S2TIME', 'S3TIME', 'S4TIME', 'S5TIME']
            .some(key => normalizeText(car[key]).toUpperCase() === 'PIT');
    }

    function toNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getTrackModel(payload) {
        if (!payload) return null;

        const trackLength = toNumber(payload.TRACKLENGTH);
        const segments = [];
        const intermediateCount = toNumber(payload.NROFINTERMEDIATETIMES);
        const lengths = [];

        for (let i = 1; i <= 9; i += 1) {
            const seg = toNumber(payload[`S${i}L`]);
            if (Number.isFinite(seg) && seg > 0) lengths.push(seg);
        }

        if (Number.isFinite(intermediateCount) && intermediateCount > 0) {
            const expected = Math.min(lengths.length, intermediateCount + 1);
            for (let i = 0; i < expected; i += 1) {
                segments.push(lengths[i]);
            }
        } else {
            segments.push(...lengths);
        }

        if (!Number.isFinite(trackLength) || !segments.length) return null;

        const cumulative = [];
        let sum = 0;
        segments.forEach(seg => {
            sum += seg;
            cumulative.push(sum);
        });

        return {
            trackLength,
            segments,
            cumulative,
        };
    }

    function getServerNowMs() {
        const offset = Number(state.timeOffsetMs);
        const delay = Number(state.delayMs) || 0;
        return Number.isFinite(offset) ? Date.now() + offset - delay : Date.now() - delay;
    }

    function computeCarProgress(car, model, serverNowMs) {
        if (!model) return null;

        const laps = toNumber(car.LAPS) ?? 0;
        let lastIndex = toNumber(car.LASTINTERMEDIATENUMBER) ?? 0;

        if (lastIndex >= 10) lastIndex = 0;

        let checkpointDistance = 0;
        if (lastIndex >= 1 && lastIndex <= model.cumulative.length) {
            checkpointDistance = model.cumulative[lastIndex - 1];
        } else if (lastIndex > model.cumulative.length) {
            checkpointDistance = model.trackLength;
        }

        // Units: timing fields in milliseconds, distances in meters, speeds in m/s.
        const lastTimeMs = toNumber(car.LASTIMTIME);
        const etaTimeMs = toNumber(car.ETA);
        let nextSegment = 0;
        let etaDistance = null;
        let segmentDurationMs = null;

        if (lastIndex >= 1 && lastIndex < model.segments.length) {
            nextSegment = model.segments[lastIndex];
        } else if (lastIndex === model.segments.length || lastIndex === 0) {
            nextSegment = model.segments[0];
        }

        if (Number.isFinite(lastTimeMs) && Number.isFinite(etaTimeMs) && etaTimeMs > lastTimeMs) {
            const rawDuration = etaTimeMs - lastTimeMs;
            segmentDurationMs = rawDuration;
            etaDistance = model.trackLength - checkpointDistance;
            if (!(etaDistance > 0)) etaDistance = model.trackLength;
        }

        const carKey = normalizeText(car.STNR);
        const cache = state.carKinematics.get(carKey) || {
            lastAnchorServerMs: null,
            lastLastTime: null,
        };

        const anchorAbs = laps * model.trackLength + checkpointDistance;

        if (Number.isFinite(lastTimeMs) && lastTimeMs !== cache.lastLastTime) {
            cache.lastAnchorServerMs = lastTimeMs;
            cache.lastLastTime = lastTimeMs;
        }

        const hasEta = Number.isFinite(segmentDurationMs) && segmentDurationMs > 0 && etaDistance > 0 && Number.isFinite(lastTimeMs);
        if (!hasEta) return null;

        const speedMps = etaDistance / (segmentDurationMs / 1000);

        const anchorBaseMs = Number.isFinite(cache.lastAnchorServerMs)
            ? cache.lastAnchorServerMs
            : serverNowMs;
        const anchorAgeMs = Math.max(0, serverNowMs - anchorBaseMs);
        const fraction = clamp(anchorAgeMs / segmentDurationMs, 0, 1);
        const progressAbs = anchorAbs + fraction * etaDistance;
        const isExtrapolated = anchorAgeMs > segmentDurationMs;

        const lapDistanceRaw = progressAbs - laps * model.trackLength;
        const lapDistance = ((lapDistanceRaw % model.trackLength) + model.trackLength) % model.trackLength;

        state.carKinematics.set(carKey, cache);

        return {
            progress: progressAbs,
            lapDistance,
            segmentDurationMs,
            segmentLength: hasEta ? etaDistance : nextSegment,
            isExtrapolated,
            speedMps,
        };
    }

    function bestLapStnr() {
        if (Array.isArray(state.latestPayload?.BEST) && state.latestPayload.BEST.length >= 4) {
            const stnr = Number(state.latestPayload.BEST[3]?.[0]);
            return Number.isFinite(stnr) ? stnr : null;
        }

        const first = state.cars.find(c => Number.isFinite(parseTime(c.FASTESTLAP)));
        return first ? Number(c.STNR) : null;
    }

    function bestSectorMap() {
        const map = new Map();
        if (!Array.isArray(state.latestPayload?.BEST)) return map;

        state.latestPayload.BEST.forEach((entry, idx) => {
            if (!Array.isArray(entry) || entry.length < 2) return;
            map.set(`S${idx + 1}TIME`, {
                stnr: Number(entry[0]),
                time: normalizeText(entry[1]),
            });
        });

        return map;
    }

    function makeCell(text, alignRight = false) {
        const td = document.createElement('td');
        td.textContent = normalizeText(text);
        td.style.padding = '3px 6px';
        td.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        td.style.whiteSpace = 'nowrap';
        td.style.overflow = 'hidden';
        td.style.textOverflow = 'ellipsis';
        td.style.textAlign = alignRight ? 'right' : 'left';
        if (alignRight) td.style.fontVariantNumeric = 'tabular-nums';
        return td;
    }

    function ensureMainOverlay() {
        let box = document.getElementById(MAIN_BOX_ID);
        const player = getPlayerContainer();
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
            th.style.background = 'rgba(255,255,255,0.08)';
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

    function ensureRelativeOverlay() {
        let box = document.getElementById(REL_BOX_ID);
        const player = getPlayerContainer();
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

        function stopPlayerShortcuts(e) {
            e.stopPropagation();
        }

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
        topRow.appendChild(status);
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

        return box;
    }

    function ensureTrackMap() {
        let box = document.getElementById(MAP_BOX_ID);
        const player = getPlayerContainer();
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
        trackPath.setAttribute(
            'd',
            'M145.250,405.250 C129.746,420.045 113.187,433.018 98.382,438.836 C94.217,440.473 88.473,442.064 87.250,440.250 C85.624,437.839 93.425,431.536 91.627,428.323 C90.246,425.853 83.616,425.675 80.238,428.813 C77.784,431.092 77.822,434.390 77.501,437.023 C76.670,443.837 70.959,449.535 65.693,458.370 C63.770,461.598 61.979,464.849 60.250,468.250 C57.614,471.068 55.979,474.587 56.250,478.250 C56.396,480.216 57.776,484.023 61.781,487.638 C64.130,489.759 69.299,491.458 71.250,495.250 C72.590,497.854 72.907,501.478 71.243,503.825 C69.821,505.830 67.363,506.328 66.629,506.483 C58.997,508.100 46.132,513.191 43.502,514.277 C36.299,517.251 31.075,521.125 28.250,524.250 C24.852,528.009 22.655,532.112 17.250,534.250 C13.047,535.913 6.652,536.517 4.250,533.250 C2.903,531.418 3.019,528.608 4.250,525.250 C6.175,520.002 10.346,516.936 16.250,513.250 C21.204,510.157 24.585,508.195 28.250,504.250 C30.563,501.760 32.225,499.332 33.250,497.250 C35.569,492.542 35.411,488.903 36.250,483.250 C36.925,478.704 38.021,474.349 39.123,471.583 C40.327,468.559 42.096,465.601 44.250,462.250 C46.812,458.263 50.598,452.018 51.250,451.250 C52.269,450.050 54.706,447.277 55.250,443.250 C55.549,441.033 55.432,437.377 53.250,434.250 C51.410,431.614 48.475,430.546 45.097,428.154 C42.094,426.028 40.573,424.384 40.250,422.250 C39.908,419.992 40.988,417.934 42.250,416.250 C48.953,407.304 70.514,394.099 77.250,387.250 C78.200,386.284 81.175,383.329 85.250,382.250 C88.627,381.356 92.357,382.043 93.250,382.250 C101.830,384.239 106.456,381.276 115.250,383.250 C117.723,383.805 123.740,385.355 127.250,382.250 C128.736,380.936 128.762,379.670 130.250,378.250 C132.618,375.990 135.537,375.961 138.598,375.519 C142.322,374.982 143.993,373.360 147.741,373.026 C148.678,372.942 153.308,372.325 156.467,371.502 C158.081,371.082 159.577,370.565 160.250,369.250 C161.741,366.335 158.514,360.711 154.250,359.250 C150.723,358.041 147.988,360.329 142.754,361.806 C137.495,363.290 132.614,363.280 130.287,362.776 C123.739,361.357 122.673,357.472 116.250,356.250 C111.334,355.314 108.704,357.364 103.552,355.988 C100.384,355.143 97.627,353.468 95.250,351.250 C91.576,347.657 88.114,344.072 84.714,340.336 C78.470,333.477 74.241,327.333 67.260,321.360 C61.229,316.200 55.749,313.463 49.806,308.201 C45.361,304.265 42.033,299.539 38.725,297.120 C38.338,296.837 36.963,295.751 36.250,294.250 C34.914,291.439 35.895,288.432 36.250,287.250 C37.440,283.289 38.954,275.623 40.250,269.250 C40.917,263.583 41.583,257.917 42.250,252.250 C44.102,246.250 44.580,240.201 43.250,234.250 C42.734,231.941 41.742,229.378 41.250,228.250 C37.822,220.398 38.245,214.829 34.250,207.250 C29.532,198.300 24.301,194.592 24.250,186.250 C24.228,182.567 25.197,177.872 28.250,174.250 C32.048,169.744 37.577,168.627 39.250,168.250 C43.637,167.261 53.944,161.569 63.250,153.250 C68.744,148.339 73.004,143.312 76.250,138.250 C79.579,133.058 81.034,128.513 84.250,123.250 C88.499,116.298 92.928,111.119 97.200,107.385 C102.728,102.553 109.494,98.555 116.593,93.810 C117.665,93.094 124.039,87.625 127.675,81.621 C129.788,78.132 130.829,74.989 130.169,71.787 C129.907,70.521 128.292,67.298 125.182,64.584 C122.035,61.838 119.043,61.118 118.256,58.489 C117.433,55.740 119.273,52.824 121.250,50.250 C125.163,45.155 130.756,39.842 132.662,38.405 C135.510,36.257 138.281,34.908 140.419,32.726 C143.475,29.606 144.995,26.646 148.250,26.250 C150.410,25.988 152.575,27.277 155.933,29.679 C158.023,31.173 159.858,32.658 161.890,33.834 C165.051,35.662 168.496,36.872 171.863,37.297 C176.886,37.930 180.458,36.762 184.607,35.635 C187.973,34.720 191.917,33.710 193.750,33.557 C197.010,33.284 199.597,33.535 202.477,31.756 C203.916,30.867 206.325,28.386 208.017,24.554 C208.691,23.028 209.481,20.676 210.234,18.597 C210.576,17.652 211.317,15.638 213.281,14.165 C214.789,13.034 216.406,12.656 217.991,12.503 C221.263,12.186 224.774,12.949 226.250,13.250 C228.170,13.641 233.293,13.368 238.215,12.364 C242.974,11.393 246.733,10.010 249.851,8.347 C251.677,7.373 255.996,5.070 256.500,4.608 C256.844,4.291 257.838,3.337 259.250,3.250 C260.465,3.175 261.806,3.770 263.250,5.250 C265.284,7.335 266.249,10.537 266.058,14.581 C265.956,16.733 265.418,18.689 264.534,21.229 C263.481,24.255 262.333,26.641 262.041,29.263 C261.661,32.665 262.209,36.163 263.703,39.236 C265.086,42.083 267.403,44.771 270.767,46.854 C273.825,48.747 277.553,49.523 278.940,49.763 C281.925,50.280 287.300,52.016 292.100,53.780 C292.372,53.880 298.159,56.273 301.519,57.243 C304.719,58.166 307.964,58.834 311.250,59.250 C316.080,60.413 320.754,62.073 325.250,64.250 C329.452,66.285 333.773,68.956 338.250,72.250 C342.409,75.311 345.030,77.650 350.140,79.543 C354.435,81.135 358.715,81.784 362.745,81.621 C365.541,81.508 370.447,80.482 375.351,78.435 C379.117,76.863 383.313,74.738 386.987,72.341 C388.034,71.657 391.717,69.501 395.575,68.878 C400.226,68.127 403.411,69.145 405.250,70.250 C406.562,71.039 410.609,73.856 410.250,77.250 C410.031,79.323 406.320,82.384 399.315,85.361 C398.310,85.788 394.633,87.925 391.973,89.932 C389.939,91.467 388.206,93.121 388.250,95.250 C388.298,97.607 390.501,99.475 392.250,100.250 C396.823,102.276 402.107,98.899 404.025,97.412 C406.562,95.444 407.413,93.034 410.535,91.179 C411.578,90.559 414.600,89.591 417.738,89.239 C420.800,88.896 422.883,89.487 425.772,88.824 C428.921,88.101 432.011,86.200 435.746,82.037 C439.645,77.690 442.964,72.330 445.858,66.939 C446.551,65.648 449.751,61.657 453.477,58.766 C454.370,58.073 455.610,57.258 457.250,57.250 C460.452,57.235 462.785,60.420 463.866,61.814 C465.077,63.375 468.781,66.703 471.484,69.570 C474.622,72.898 478.234,76.051 480.250,77.250 C485.110,80.139 489.599,81.030 492.124,85.638 C492.798,86.868 493.446,88.762 493.648,91.179 C494.109,96.699 491.332,100.050 491.016,104.614 C490.845,107.083 491.952,110.253 492.540,113.756 C493.138,117.324 493.409,120.255 494.617,122.206 C495.763,124.054 497.227,125.361 497.249,127.608 C497.261,128.731 496.818,130.377 495.250,132.250 C492.794,135.184 488.952,136.773 483.536,137.581 C478.465,138.337 472.175,139.023 469.407,138.827 C469.099,138.805 468.125,138.747 467.250,139.250 C464.857,140.626 465.097,144.819 464.974,148.523 C464.922,150.079 463.899,155.632 463.312,159.604 C463.025,161.544 462.515,164.911 459.987,168.054 C457.375,171.300 454.143,172.389 450.983,173.594 C446.930,175.140 442.869,176.992 440.733,178.442 C436.719,181.166 433.605,184.857 431.250,189.250 C428.917,192.917 426.583,196.583 424.250,200.250 C421.147,202.377 417.812,204.060 414.250,205.250 C406.679,207.779 397.865,206.455 393.774,206.837 C388.134,207.364 384.932,208.256 380.753,206.560 C377.061,205.062 374.924,202.559 370.780,200.881 C366.897,199.309 364.395,199.367 363.250,200.250 C361.795,201.371 362.081,203.486 361.776,206.976 C361.470,210.469 360.473,212.780 361.499,214.456 C363.462,217.663 368.864,216.950 372.303,219.719 C373.223,220.460 375.192,223.376 376.598,226.645 C378.149,230.255 377.921,232.810 379.645,236.341 C380.367,237.819 381.110,239.010 380.753,240.496 C380.114,243.158 376.611,243.930 372.165,246.314 C370.787,247.052 369.444,247.886 368.148,248.807 C363.371,252.202 361.496,256.013 357.250,259.250 C352.698,262.720 348.999,262.815 343.491,264.874 C338.057,266.907 332.434,271.302 325.899,275.401 C320.202,278.975 314.160,282.588 309.553,284.820 C304.745,287.150 300.524,288.769 295.563,290.638 C288.824,293.177 282.112,296.027 275.250,299.250 C266.467,302.712 258.133,306.704 250.250,311.250 C245.290,314.110 241.189,317.029 236.137,319.726 C232.827,321.493 230.101,322.884 226.995,324.989 C221.532,328.692 217.579,332.512 213.250,337.250 C208.787,342.134 205.288,346.848 200.814,351.722 C197.693,355.124 192.771,359.633 188.347,363.773 C184.200,367.655 179.003,372.489 176.250,375.250 C171.232,380.283 167.237,385.248 162.167,390.229 C158.944,393.395 155.670,396.374 152.250,399.250 C149.917,401.250 147.583,403.250 145.250,405.250 Z'
        );

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

    function ensureSettingsToggle() {
        let button = document.getElementById(SETTINGS_TOGGLE_ID);
        const player = getPlayerContainer();
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
        const player = getPlayerContainer();
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
            const clamped = clamp(seconds, 0, 600);
            state.delayMs = clamped * 1000;
        }

        function updateDotSize() {
            const size = Number(dotInput.value);
            if (!Number.isFinite(size)) return;
            state.dotSize = clamp(size, 1, 10);
            renderTrackMap();
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

    function renderTrackMap() {
        if (!state.mapDots || !state.mapMarkers || !state.mapTrackPath) return;
        if (!state.latestPayload) return;

        const model = getTrackModel(state.latestPayload);
        if (!model) return;

        const serverNowMs = getServerNowMs();
        const selected = state.selectedStartNumber.trim();

        state.mapMarkers.replaceChildren();
        state.mapDots.replaceChildren();

        const pathLength = state.mapTrackPath.getTotalLength();
        if (!Number.isFinite(pathLength) || pathLength <= 0) return;

        function classColor(className) {
            const text = normalizeText(className).toUpperCase();
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
                AT2: '#a3e635',
            };

            if (palette[prefix]) return palette[prefix];
            if (palette[key]) return palette[key];
            return '#cbd5f5';
        }

        function addMarkerAtLength(length, color, width, size) {
            const base = clamp(length, 0, pathLength);
            const p1 = state.mapTrackPath.getPointAtLength(base);
            const p2 = state.mapTrackPath.getPointAtLength(clamp(base + 1, 0, pathLength));
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
            state.mapMarkers.appendChild(line);
        }

        // Start/finish line
        addMarkerAtLength(0, 'rgba(255,255,255,0.95)', '3', 26);

        // Timing sector lines
        model.cumulative.forEach((distance) => {
            const fraction = distance / model.trackLength;
            addMarkerAtLength(fraction * pathLength, 'rgba(255,255,255,0.35)', '1.5', 18);
        });

        state.cars.forEach(car => {
            const progress = computeCarProgress(car, model, serverNowMs);
            if (!progress) return;

            const fraction = progress.lapDistance / model.trackLength;
            const point = state.mapTrackPath.getPointAtLength(clamp(fraction, 0, 1) * pathLength);
            const x = point.x;
            const y = point.y;
            const isSelected = normalizeText(car.STNR) === selected;
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
            const baseSize = clamp(Number(state.dotSize) || CONFIG.defaultDotSize, 1, 10);
            const radius = isSelected ? baseSize + 1 : baseSize;
            dot.setAttribute('r', radius.toFixed(1));
            dot.setAttribute('fill', dotColor);
            dot.setAttribute('stroke', isSelected ? '#22c55e' : 'rgba(0,0,0,0.5)');
            dot.setAttribute('stroke-width', '0.5');
            dot.style.cursor = 'pointer';
            dot.style.pointerEvents = 'auto';
            dot.addEventListener('click', (event) => {
                event.stopPropagation();
                state.selectedStartNumber = normalizeText(car.STNR);
                if (state.relInput) state.relInput.value = state.selectedStartNumber;
                renderRelative();
                renderTrackMap();
            });
            state.mapDots.appendChild(dot);
        });
    }

    function updateVisibility() {
        const main = ensureMainOverlay();
        const rel = ensureRelativeOverlay();
        const map = ensureTrackMap();
        const settings = ensureSettingsOverlay();
        const settingsToggle = ensureSettingsToggle();
        const show = matches();

        if (main) main.style.display = show ? 'block' : 'none';
        if (rel) rel.style.display = show ? 'block' : 'none';
        if (map) map.style.display = show ? 'block' : 'none';
        if (settings) settings.style.display = show && state.settingsOpen ? 'block' : 'none';
        if (settingsToggle) settingsToggle.style.display = show ? 'block' : 'none';
    }

    function renderMain() {
        if (!matches()) return;
        if (!state.mainTbody) return;

        state.mainTbody.replaceChildren();

        const rows = state.cars.slice(0, CONFIG.maxRows);
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
                makeCell(car.S5TIME, true),
            ];

            cells[0].style.fontWeight = '700';
            cells[1].style.fontWeight = '700';

            const lastLap = normalizeText(car.LASTLAPTIME);
            const bestLap = normalizeText(car.FASTESTLAP);
            if (lastLap && bestLap && lastLap === bestLap) {
                cells[7].style.color = '#22c55e';
                cells[7].style.fontWeight = '700';
            }

            ['S1TIME', 'S2TIME', 'S3TIME', 'S4TIME', 'S5TIME'].forEach((key, i) => {
                const best = sectorBest.get(key);
                if (!best) return;

                if (Number(car.STNR) === best.stnr && normalizeText(car[key]) === best.time) {
                    const td = cells[8 + i];
                    td.style.color = '#22c55e';
                    td.style.fontWeight = '700';
                    td.style.background = 'rgba(34,197,94,0.08)';
                }
            });

            cells.forEach(td => tr.appendChild(td));
            tr.addEventListener('click', (event) => {
                event.stopPropagation();
                state.selectedStartNumber = normalizeText(car.STNR);
                if (state.relInput) state.relInput.value = state.selectedStartNumber;
                renderRelative();
                renderTrackMap();
            });
            state.mainTbody.appendChild(tr);
        });
    }

    function formatRelativeValue(selectedCar, otherCar, selectedIndex, otherIndex) {
        if (selectedIndex === otherIndex) {
            return '0.000';
        }

        const selectedLaps = Number(selectedCar.LAPS);
        const otherLaps = Number(otherCar.LAPS);

        const selectedGap = parseGapSeconds(selectedCar.GAP);
        const otherGap = parseGapSeconds(otherCar.GAP);

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

        const selectedGapLap = parseGapLapNumber(selectedCar.GAP);
        const otherGapLap = parseGapLapNumber(otherCar.GAP);
        const leaderLap = Number.isFinite(state.leaderLap) ? state.leaderLap : null;

        if (Number.isFinite(selectedGapLap) || Number.isFinite(otherGapLap) || Number.isFinite(leaderLap)) {
            if (Number.isFinite(selectedLaps) && Number.isFinite(otherLaps)) {
                const delta = otherLaps - selectedLaps;
                return `${delta > 0 ? '+' : ''}${delta}L`;
            }
        }

        return otherIndex < selectedIndex ? '+?' : '-?';
    }

    function renderRelative() {
        if (!matches()) return;
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
            const eligibleCars = state.cars.filter(car => !isRetired(car));
            const total = eligibleCars.length;
            const updated = eligibleCars.filter(car => state.timingUpdated.has(normalizeText(car.STNR))).length;
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
        const selectedIndex = state.cars.findIndex(c => normalizeText(c.STNR) === selected);

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
        const selectedLaps = toNumber(selectedCar.LAPS);
        const trackModel = getTrackModel(state.latestPayload);
        const serverNowMs = getServerNowMs();
        const selectedProgress = computeCarProgress(selectedCar, trackModel, serverNowMs);

        function applyRelativeRowBackground(row, car, globalIndex) {
            if (globalIndex === selectedIndex) {
                row.style.background = 'rgba(34,197,94,0.18)';
                return 'rgba(34,197,94,0.18)';
            }

            const carLaps = toNumber(car.LAPS);
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

        function applyCellBackground(cells, bg) {
            if (!bg) return;
            cells.forEach(cell => {
                cell.style.background = bg;
            });
        }

        if (!trackModel || !selectedProgress) {
            const start = Math.max(0, selectedIndex - CONFIG.relativeRowsBefore);
            const end = Math.min(state.cars.length, selectedIndex + CONFIG.relativeRowsAfter + 1);
            const rows = state.cars.slice(start, end);

            rows.forEach((car, localIndex) => {
                const globalIndex = start + localIndex;
                const tr = document.createElement('tr');

                const rowBg = applyRelativeRowBackground(tr, car, globalIndex);

                const relValue = formatRelativeValue(selectedCar, car, selectedIndex, globalIndex);
                const relDisplay = relValue.includes('?') ? `~${relValue}` : relValue;

                const cells = [
                    makeCell(car.POSITION),
                    makeCell(car.STNR),
                    makeCell(car.NAME),
                    makeCell(car.CAR),
                    makeCell(car.CLASSNAME),
                    makeCell(car.LAPS, true),
                    makeCell('n/a', true),
                    makeCell(formatSpeedKph(null), true),
                    makeCell(relDisplay, true),
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

        function signedTrackDelta(selectedDistance, otherDistance, trackLength) {
            if (!Number.isFinite(selectedDistance) || !Number.isFinite(otherDistance)) return null;
            const raw = otherDistance - selectedDistance;
            const wrapped = ((raw + trackLength / 2) % trackLength + trackLength) % trackLength - trackLength / 2;
            return wrapped;
        }

        const entries = state.cars.map((car, index) => {
            const progressInfo = computeCarProgress(car, trackModel, serverNowMs);
            const deltaTrack = progressInfo
                ? signedTrackDelta(selectedProgress.lapDistance, progressInfo.lapDistance, trackModel.trackLength)
                : null;

            return {
                car,
                index,
                progressInfo,
                deltaTrack,
            };
        });

        const ahead = entries
            .filter(entry => Number.isFinite(entry.deltaTrack) && entry.deltaTrack > 0)
            .sort((a, b) => a.deltaTrack - b.deltaTrack)
            .slice(0, CONFIG.relativeRowsAfter);

        const behind = entries
            .filter(entry => Number.isFinite(entry.deltaTrack) && entry.deltaTrack < 0)
            .sort((a, b) => b.deltaTrack - a.deltaTrack)
            .slice(0, CONFIG.relativeRowsBefore);

        const selectedEntry = entries.find(entry => entry.index === selectedIndex);
        const rows = [...ahead.slice().reverse(), selectedEntry, ...behind].filter(Boolean);

        function buildEstimatedPositionMap(items) {
            const ranked = items
                .filter(entry => Number.isFinite(entry.progressInfo?.progress))
                .slice()
                .sort((a, b) => {
                    const delta = b.progressInfo.progress - a.progressInfo.progress;
                    if (delta !== 0) return delta;
                    const posA = toNumber(a.car.POSITION) ?? Number.POSITIVE_INFINITY;
                    const posB = toNumber(b.car.POSITION) ?? Number.POSITIVE_INFINITY;
                    return posA - posB;
                });

            const map = new Map();
            ranked.forEach((entry, idx) => {
                map.set(normalizeText(entry.car.STNR), idx + 1);
            });

            return map;
        }

        function applyEstimatedPositionMarker(cell, car, estimatedMap) {
            const estPos = estimatedMap.get(normalizeText(car.STNR));
            const socketPos = toNumber(car.POSITION);
            if (!Number.isFinite(estPos)) return;

            cell.textContent = String(estPos);
            if (Number.isFinite(socketPos) && estPos !== socketPos) {
                cell.style.color = '#f59e0b';
                cell.style.fontWeight = '700';
                cell.title = `Socket pos: ${socketPos} (timing update pending)`;
            }
        }

        const estimatedPositionMap = buildEstimatedPositionMap(entries);

        function formatSpeedKph(progressInfo) {
            const speed = progressInfo?.speedMps;
            if (!Number.isFinite(speed) || speed <= 0) return 'n/a';
            return `${Math.round(speed * 3.6)} km/h`;
        }

        function formatProgressPercent(progressInfo) {
            if (!progressInfo) return 'n/a';
            const pct = (progressInfo.lapDistance / trackModel.trackLength) * 100;
            if (!Number.isFinite(pct)) return 'n/a';
            return `${pct.toFixed(1)}%`;
        }

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
                makeCell(car.POSITION),
                makeCell(car.STNR),
                makeCell(car.NAME),
                makeCell(car.CAR),
                makeCell(car.CLASSNAME),
                makeCell(car.LAPS, true),
                makeCell(progressValue, true),
                makeCell(formatSpeedKph(progressInfo), true),
                makeCell(relValue, true),
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

    function connect() {
        if (state.ws) return;

        const main = ensureMainOverlay();
        const rel = ensureRelativeOverlay();
        if (!main || !rel) return;

        state.mainStatus.textContent = 'Status: connecting';

        state.ws = new WebSocket(CONFIG.wsUrl);

        state.ws.onopen = () => {
            state.mainStatus.textContent = 'Status: connected';
            state.ws.send(JSON.stringify({
                eventId: CONFIG.eventId,
                eventPid: CONFIG.eventPid,
                clientLocalTime: Date.now()
            }));
        };

        state.ws.onmessage = (e) => {
            try {
                const p = JSON.parse(e.data);

                if (p?.PID === 'LTS_TIMESYNC') {
                    const serverTime = toNumber(p.serverLocalTime);
                    const clientTime = toNumber(p.clientLocalTime);
                    if (Number.isFinite(serverTime) && Number.isFinite(clientTime)) {
                        state.timeOffsetMs = serverTime - clientTime;
                    }
                }

                if (Array.isArray(p.RESULT)) {
                    if (!state.latestPayload) {
                        state.carKinematics.clear();
                        state.timingInit.clear();
                        state.timingUpdated.clear();
                        state.relEstimateCompleted = false;
                        if (state.relEstimateStatus) {
                            state.relEstimateStatus.style.display = 'none';
                            state.relEstimateStatus.textContent = '';
                        }
                    }

                    const leader = p.RESULT.find(entry => normalizeText(entry.POSITION) === '1');
                    const leaderGapLap = leader ? parseGapLapNumber(leader.GAP) : null;
                    if (Number.isFinite(leaderGapLap)) {
                        state.leaderLap = leaderGapLap;
                    } else {
                        const gapLap = p.RESULT.map(entry => parseGapLapNumber(entry.GAP)).find(Number.isFinite);
                        state.leaderLap = Number.isFinite(gapLap) ? gapLap : state.leaderLap;
                    }

                    p.RESULT.forEach((car) => {
                        const carKey = normalizeText(car.STNR);
                        const lastTime = toNumber(car.LASTIMTIME);
                        if (!Number.isFinite(lastTime)) return;

                        if (!state.timingInit.has(carKey)) {
                            state.timingInit.set(carKey, lastTime);
                            return;
                        }

                        if (lastTime !== state.timingInit.get(carKey)) {
                            state.timingUpdated.add(carKey);
                        }
                    });

                    state.latestPayload = p;
                    state.cars = [...p.RESULT].sort((a, b) => {
                        const posA = toNumber(a.POSITION) ?? Number.POSITIVE_INFINITY;
                        const posB = toNumber(b.POSITION) ?? Number.POSITIVE_INFINITY;
                        return posA - posB;
                    });

                    if (!state.initialSelectionDone && leader) {
                        state.selectedStartNumber = normalizeText(leader.STNR);
                        if (state.relInput) state.relInput.value = state.selectedStartNumber;
                        state.initialSelectionDone = true;
                    }

                    renderMain();
                    renderRelative();
                }
            } catch {}
        };
    }

    function tick() {
        const main = ensureMainOverlay();
        const rel = ensureRelativeOverlay();
        const map = ensureTrackMap();
        const settings = ensureSettingsOverlay();
        const settingsToggle = ensureSettingsToggle();
        if (!main || !rel || !map || !settings || !settingsToggle) return;

        updateVisibility();

        if (state.mainMeta) {
            state.mainMeta.textContent = `${getChannel()} | ${getTitle()}`;
        }

        const player = getPlayerContainer();
        if (player) {
            const style = window.getComputedStyle(player);
            if (style.position === 'static') {
                player.style.position = 'relative';
            }

            if (main.parentElement !== player) player.appendChild(main);
            if (rel.parentElement !== player) player.appendChild(rel);
            if (map.parentElement !== player) player.appendChild(map);
            if (settings.parentElement !== player) player.appendChild(settings);
            if (settingsToggle.parentElement !== player) player.appendChild(settingsToggle);
        }
    }

    tick();
    connect();
    setInterval(tick, 1000);
    setInterval(() => {
        if (!state.latestPayload) return;
        renderRelative();
        renderTrackMap();
    }, CONFIG.relativeUpdateMs);
})();