(() => {
    const NLS = window.NLS || (window.NLS = {});
    const state = NLS.state;

    /**
     * Build track model data from the timing payload.
     * @param {Record<string, unknown>|null} payload
     * @returns {{trackLength:number, segments:number[], cumulative:number[]} | null}
     */
    function getTrackModel(payload) {
        if (!payload) return null;

        const trackLength = NLS.toNumber(payload.TRACKLENGTH);
        const segments = [];
        const intermediateCount = NLS.toNumber(payload.NROFINTERMEDIATETIMES);
        const lengths = [];

        for (let i = 1; i <= 9; i += 1) {
            const seg = NLS.toNumber(payload[`S${i}L`]);
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
            cumulative
        };
    }

    /**
     * Compute a server-aligned timestamp adjusted by the local delay.
     * @returns {number}
     */
    function getServerNowMs() {
        const offset = Number(state.timeOffsetMs);
        const delay = Number(state.delayMs) || 0;
        return Number.isFinite(offset) ? Date.now() + offset - delay : Date.now() - delay;
    }

    /**
     * Estimate per-car progress and speed along the track.
     * @param {Record<string, unknown>} car
     * @param {{trackLength:number, segments:number[], cumulative:number[]}} model
     * @param {number} serverNowMs
     * @returns {{progress:number, lapDistance:number, segmentDurationMs:number|null, segmentLength:number|null, isExtrapolated:boolean, speedMps:number} | null}
     */
    function computeCarProgress(car, model, serverNowMs) {
        if (!model) return null;

        const laps = NLS.toNumber(car.LAPS) ?? 0;
        let lastIndex = NLS.toNumber(car.LASTINTERMEDIATENUMBER) ?? 0;

        if (lastIndex >= 10) lastIndex = 0;

        let checkpointDistance = 0;
        if (lastIndex >= 1 && lastIndex <= model.cumulative.length) {
            checkpointDistance = model.cumulative[lastIndex - 1];
        } else if (lastIndex > model.cumulative.length) {
            checkpointDistance = model.trackLength;
        }

        const lastTimeMs = NLS.toNumber(car.LASTIMTIME);
        const etaTimeMs = NLS.toNumber(car.ETA);
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

        const carKey = NLS.normalizeText(car.STNR);
        const cache = state.carKinematics.get(carKey) || {
            lastAnchorServerMs: null,
            lastLastTime: null,
            learnedSpeedMps: null
        };

        const anchorAbs = laps * model.trackLength + checkpointDistance;

        if (Number.isFinite(lastTimeMs) && lastTimeMs !== cache.lastLastTime) {
            if (Number.isFinite(cache.lastAnchorServerMs)) {
                const actualDurationMs = lastTimeMs - cache.lastAnchorServerMs;
                const completedIndex = lastIndex === 0 ? model.segments.length : lastIndex;
                const completedLength = model.segments[completedIndex - 1];
                if (Number.isFinite(actualDurationMs) && actualDurationMs > 0 && Number.isFinite(completedLength) && completedLength > 0) {
                    const actualSpeedMps = completedLength / (actualDurationMs / 1000);
                    if (Number.isFinite(actualSpeedMps) && actualSpeedMps > 0) {
                        const prevSpeed = cache.learnedSpeedMps;
                        cache.learnedSpeedMps = Number.isFinite(prevSpeed)
                            ? prevSpeed * 0.6 + actualSpeedMps * 0.4
                            : actualSpeedMps;
                    }
                }
            }

            cache.lastAnchorServerMs = lastTimeMs;
            cache.lastLastTime = lastTimeMs;
        }

        const hasEta = Number.isFinite(segmentDurationMs) && segmentDurationMs > 0 && etaDistance > 0 && Number.isFinite(lastTimeMs);

        const sectorIndex = lastIndex === 0 ? model.segments.length : lastIndex;
        const sectorLength = model.segments[sectorIndex - 1] || nextSegment || null;
        const sectorTimeSeconds = sectorIndex >= 1 && sectorIndex <= 9
            ? NLS.parseTime(car[`S${sectorIndex}TIME`])
            : Number.POSITIVE_INFINITY;
        const sectorTimeMs = Number.isFinite(sectorTimeSeconds) && sectorTimeSeconds > 0
            ? sectorTimeSeconds * 1000
            : null;
        const learnedDurationMs = Number.isFinite(cache.learnedSpeedMps) && cache.learnedSpeedMps > 0 && Number.isFinite(sectorLength) && sectorLength > 0
            ? (sectorLength / cache.learnedSpeedMps) * 1000
            : null;
        const hasKinematic = Number.isFinite(sectorLength) && sectorLength > 0 && Number.isFinite(sectorTimeMs) && sectorTimeMs > 0 && Number.isFinite(lastTimeMs);

        if (!hasEta && !hasKinematic) return null;

        const anchorBaseMs = Number.isFinite(cache.lastAnchorServerMs)
            ? cache.lastAnchorServerMs
            : serverNowMs;
        const anchorAgeMs = Math.max(0, serverNowMs - anchorBaseMs);

        let etaProgressAbs = null;
        let etaSpeedMps = null;
        let etaExtrapolated = false;
        if (hasEta) {
            etaSpeedMps = etaDistance / (segmentDurationMs / 1000);
            const fraction = NLS.clamp(anchorAgeMs / segmentDurationMs, 0, 1);
            etaProgressAbs = anchorAbs + fraction * etaDistance;
            etaExtrapolated = anchorAgeMs > segmentDurationMs;
        }

        let kinProgressAbs = null;
        let kinSpeedMps = null;
        let kinExtrapolated = false;
        if (hasKinematic) {
            const kinDurationMs = Number.isFinite(learnedDurationMs) ? learnedDurationMs : sectorTimeMs;
            kinSpeedMps = sectorLength / (kinDurationMs / 1000);
            const fraction = NLS.clamp(anchorAgeMs / kinDurationMs, 0, 1);
            kinProgressAbs = anchorAbs + fraction * sectorLength;
            kinExtrapolated = anchorAgeMs > kinDurationMs;
        }

        // Blend ETA-based and kinematic estimates as the segment ages.
        let weightEta = 0;
        let weightKin = 0;
        if (hasEta && hasKinematic) {
            const mix = NLS.clamp(anchorAgeMs / segmentDurationMs, 0, 1);
            weightEta = 1 - mix;
            weightKin = mix;
        } else if (hasEta) {
            weightEta = 1;
        } else if (hasKinematic) {
            weightKin = 1;
        }

        const weightSum = weightEta + weightKin || 1;
        const progressAbs = (
            (etaProgressAbs ?? 0) * weightEta +
            (kinProgressAbs ?? 0) * weightKin
        ) / weightSum;

        const speedMps = (
            (etaSpeedMps ?? 0) * weightEta +
            (kinSpeedMps ?? 0) * weightKin
        ) / weightSum;

        const lapDistanceRaw = progressAbs - laps * model.trackLength;
        const lapDistance = ((lapDistanceRaw % model.trackLength) + model.trackLength) % model.trackLength;
        const isExtrapolated = etaExtrapolated || kinExtrapolated;

        state.carKinematics.set(carKey, cache);

        return {
            progress: progressAbs,
            lapDistance,
            segmentDurationMs: hasEta ? segmentDurationMs : sectorTimeMs,
            segmentLength: hasEta ? etaDistance : sectorLength,
            isExtrapolated,
            speedMps
        };
    }

    NLS.getTrackModel = getTrackModel;
    NLS.getServerNowMs = getServerNowMs;
    NLS.computeCarProgress = computeCarProgress;
})();
