(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;

    /**
     * Connect to the timing websocket and stream updates into state.
     */
    function connect() {
        if (state.ws) return;

        const main = NLS.ensureMainOverlay();
        const rel = NLS.ensureRelativeOverlay();
        if (!main || !rel) return;

        state.mainStatus.textContent = 'Status: connecting';

        NLS.log('WS connecting', NLS.CONFIG.wsUrl);
        state.ws = new WebSocket(NLS.CONFIG.wsUrl);

        state.ws.onopen = () => {
            state.mainStatus.textContent = 'Status: connected';
            const override = NLS.CONFIG.clientLocalTimeOverride;
            const overrideMs = Number.isFinite(override)
                ? override
                : (override ? Date.parse(String(override)) : NaN);
            const clientLocalTime = Number.isFinite(overrideMs) ? overrideMs : Date.now();
            NLS.log('WS connected, sending init', {
                eventId: NLS.CONFIG.eventId,
                eventPid: NLS.CONFIG.eventPid,
                clientLocalTime
            });
            state.ws.send(JSON.stringify({
                eventId: NLS.CONFIG.eventId,
                eventPid: NLS.CONFIG.eventPid,
                clientLocalTime
            }));
        };

        state.ws.onerror = (event) => {
            NLS.log('WS error', event);
        };

        state.ws.onclose = (event) => {
            NLS.log('WS closed', { code: event.code, reason: event.reason });
        };

        state.ws.onmessage = (e) => {
            try {
                const p = JSON.parse(e.data);

                // Track server time offset to align progress estimation.
                if (p?.PID === 'LTS_TIMESYNC') {
                    const serverTime = NLS.toNumber(p.serverLocalTime);
                    const clientTime = NLS.toNumber(p.clientLocalTime);
                    if (Number.isFinite(serverTime) && Number.isFinite(clientTime)) {
                        state.timeOffsetMs = serverTime - clientTime;
                        NLS.log('WS timesync', { offsetMs: state.timeOffsetMs });
                    }
                }

                if (Array.isArray(p.RESULT)) {
                    NLS.log('WS timing update', { cars: p.RESULT.length });
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

                    const leader = p.RESULT.find(entry => NLS.normalizeText(entry.POSITION) === '1');
                    const leaderGapLap = leader ? NLS.parseGapLapNumber(leader.GAP) : null;
                    if (Number.isFinite(leaderGapLap)) {
                        state.leaderLap = leaderGapLap;
                    } else {
                        const gapLap = p.RESULT.map(entry => NLS.parseGapLapNumber(entry.GAP)).find(Number.isFinite);
                        state.leaderLap = Number.isFinite(gapLap) ? gapLap : state.leaderLap;
                    }

                    p.RESULT.forEach((car) => {
                        const carKey = NLS.normalizeText(car.STNR);
                        const lastTime = NLS.toNumber(car.LASTIMTIME);
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
                        const posA = NLS.toNumber(a.POSITION) ?? Number.POSITIVE_INFINITY;
                        const posB = NLS.toNumber(b.POSITION) ?? Number.POSITIVE_INFINITY;
                        return posA - posB;
                    });

                    if (!state.initialSelectionDone && leader) {
                        state.selectedStartNumber = NLS.normalizeText(leader.STNR);
                        if (state.relInput) state.relInput.value = state.selectedStartNumber;
                        state.initialSelectionDone = true;
                    }

                    NLS.renderMain();
                    NLS.renderRelative();
                }
            } catch {}
        };
    }

    NLS.connect = connect;
})();
