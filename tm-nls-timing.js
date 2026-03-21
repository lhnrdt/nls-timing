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
        mapDots: null,
        mapMarkers: null,

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
        return Number.isFinite(offset) ? Date.now() + offset : Date.now();
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
        svg.setAttribute('viewBox', '0 0 440 440');
        svg.setAttribute('width', '440');
        svg.setAttribute('height', '440');

        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('cx', '220');
        ring.setAttribute('cy', '220');
        ring.setAttribute('r', '188');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', 'rgba(255,255,255,0.6)');
        ring.setAttribute('stroke-width', '2');

        const markers = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const dots = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        svg.appendChild(ring);
        svg.appendChild(markers);
        svg.appendChild(dots);
        box.appendChild(svg);

        player.appendChild(box);
        state.mapBox = box;
        state.mapSvg = svg;
        state.mapDots = dots;
        state.mapMarkers = markers;

        return box;
    }

    function renderTrackMap() {
        if (!state.mapDots || !state.mapMarkers) return;
        if (!state.latestPayload) return;

        const model = getTrackModel(state.latestPayload);
        if (!model) return;

        const serverNowMs = getServerNowMs();
        const selected = state.selectedStartNumber.trim();

        state.mapMarkers.replaceChildren();
        state.mapDots.replaceChildren();

        const center = 220;
        const radius = 172;
        const startAngle = -Math.PI / 2;
        const tickOuter = radius;
        const tickInnerStartFinish = radius - 18;
        const tickInnerSector = radius - 10;

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

        function addMarker(angle, color, width, innerRadius) {
            const x1 = center + Math.cos(angle) * innerRadius;
            const y1 = center + Math.sin(angle) * innerRadius;
            const x2 = center + Math.cos(angle) * tickOuter;
            const y2 = center + Math.sin(angle) * tickOuter;
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
        addMarker(startAngle, 'rgba(255,255,255,0.95)', '3', tickInnerStartFinish);

        // Timing sector lines
        model.cumulative.forEach((distance) => {
            const fraction = distance / model.trackLength;
            const angle = fraction * Math.PI * 2 + startAngle;
            addMarker(angle, 'rgba(255,255,255,0.35)', '1.5', tickInnerSector);
        });

        state.cars.forEach(car => {
            const progress = computeCarProgress(car, model, serverNowMs);
            if (!progress) return;

            const fraction = progress.lapDistance / model.trackLength;
            const angle = fraction * Math.PI * 2 + startAngle;
            const x = center + Math.cos(angle) * radius;
            const y = center + Math.sin(angle) * radius;
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
            dot.setAttribute('r', isSelected ? '3.5' : '2.5');
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
        const show = matches();

        if (main) main.style.display = show ? 'block' : 'none';
        if (rel) rel.style.display = show ? 'block' : 'none';
        if (map) map.style.display = show ? 'block' : 'none';
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

                    const hasSelected = state.selectedStartNumber && state.cars.some(
                        car => normalizeText(car.STNR) === state.selectedStartNumber
                    );
                    if (!hasSelected && leader) {
                        state.selectedStartNumber = normalizeText(leader.STNR);
                        if (state.relInput) state.relInput.value = state.selectedStartNumber;
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
        if (!main || !rel || !map) return;

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