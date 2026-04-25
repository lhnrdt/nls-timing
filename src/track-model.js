(() => {
    const NLS = window.NLS || (window.NLS = {});

    /**
     * Build track model from payload
     * Track structure: [Start/Finish (i10)] S1 [i1] S2 [i2] S3 [i3] S4 [i4] S5 [SF (i10)]
     * - 5 sectors with their lengths (S1L, S2L, S3L, S4L, S5L)
     * - 4 intermediates at sector boundaries: i1 (end of S1), i2, i3, i4
     * - LASTINTERMEDIATENUMBER: 10=start/finish, 1=crossed i1 (in S2), 2=crossed i2 (in S3), etc
     */
    function getOrCreateModel(payload) {
        if (!payload) return null;

        const trackLength = NLS.toNumber(payload.TRACKLENGTH);
        if (!Number.isFinite(trackLength)) return null;

        // Return cached model if same track
        if (NLS._trackModelCache?.trackLength === trackLength) {
            return NLS._trackModelCache;
        }

        // Parse sector lengths
        const sectors = [];
        for (let i = 1; i <= 9; i++) {
            const length = NLS.toNumber(payload[`S${i}L`]);
            if (!Number.isFinite(length) || length <= 0) break;
            sectors.push(length);
        }

        if (sectors.length === 0) return null;

        // Build intermediate distances (at sector boundaries)
        const intermediates = [];
        let cumDistance = 0;
        for (let i = 0; i < sectors.length - 1; i++) {
            cumDistance += sectors[i];
            intermediates.push(cumDistance);
        }

        // Build cumulative distances for reference
        const cumulative = [];
        cumDistance = 0;
        for (let i = 0; i < sectors.length; i++) {
            cumDistance += sectors[i];
            cumulative.push(cumDistance);
        }

        const model = {
            trackLength,
            sectors,
            intermediates,  // [2745, 5749, 11752, 21161] for Nürburgring
            cumulative,     // [2745, 5749, 11752, 21161, 24358] for Nürburgring
        };

        NLS._trackModelCache = model;
        return model;
    }

    /**
     * Get a sector time from another car in the same class (as fallback)
     */
    function findClassBasedSectorTime(car, sectorNum) {
        if (!NLS.state?.cars || !NLS.storage?.loadSectorTime) return null;
        
        const carClass = NLS.normalizeText(car.CLASSNAME);
        const sectorKey = `S${sectorNum}TIME`;
        
        // Search for another car in the same class with this sector time cached
        for (const otherCar of NLS.state.cars) {
            if (otherCar === car) continue;
            if (NLS.normalizeText(otherCar.CLASSNAME) !== carClass) continue;
            
            const cachedTimeMs = NLS.storage.loadSectorTime(otherCar.STNR, sectorKey);
            if (Number.isFinite(cachedTimeMs) && cachedTimeMs > 0) {
                const timeSeconds = cachedTimeMs / 1000;
                return { timeSeconds, sourceSttnr: NLS.normalizeText(otherCar.STNR) };
            }
        }
        
        return null;
    }

    /**
     * Get the timestamp when the car last crossed its current intermediate.
     */
    function getLastIntermediateTimestampMs(car, lastIntNum) {
        const timestampKey = `${NLS.normalizeText(car.STNR)}:INTERMEDIATE_${lastIntNum}`;
        return window.NLS?.intermediateTimestamps?.[timestampKey] ?? null;
    }

    /**
     * Compute car progress on main thread (fallback)
     */
    function computeCarProgressMainThread(car, model, serverNowMs) {
        if (!model || !car) return null;

        const lastIntNum = NLS.toNumber(car.LASTINTERMEDIATENUMBER) ?? 10;
        
        // Determine base position and current sector
        let lapDistance = 0;
        let currentSectorIdx = 0; // 0-indexed (0=S1, 1=S2, etc)
        
        if (lastIntNum === 10) {
            // At start/finish line, in sector 1
            lapDistance = 0;
            currentSectorIdx = 0;
        } else if (lastIntNum >= 1 && lastIntNum <= model.cumulative.length) {
            // At intermediate N, so in sector N+1
            lapDistance = model.cumulative[lastIntNum - 1];
            currentSectorIdx = lastIntNum;
        }
        
        // Calculate speed and interpolate through current sector if we have timing data
        let estimatedSpeedMps = 60; // Default fallback (216 km/h - reasonable for race cars)
        let speedSource = 'Default fallback (60 m/s = 216 km/h)';
        
        if (currentSectorIdx >= 0 && currentSectorIdx < model.sectors.length) {
            const sectorNum = currentSectorIdx + 1; // 1-indexed
            let sectorTimeSeconds = null;
            
            // Try to get cached sector time for this specific sector from localStorage
            if (NLS.storage?.loadSectorTime) {
                const cachedTimeMs = NLS.storage.loadSectorTime(car.STNR, `S${sectorNum}TIME`);
                if (Number.isFinite(cachedTimeMs) && cachedTimeMs > 0) {
                    sectorTimeSeconds = cachedTimeMs / 1000;
                    const sectorDistance = model.sectors[currentSectorIdx];
                    speedSource = `S${sectorNum} cached: ${(sectorDistance/1000).toFixed(2)}km ÷ ${sectorTimeSeconds.toFixed(1)}s`;
                }
            }
            
            // Fallback: If no cached time for this car's sector, try class-based fallback
            if (!Number.isFinite(sectorTimeSeconds)) {
                const classBasedResult = findClassBasedSectorTime(car, sectorNum);
                if (classBasedResult) {
                    sectorTimeSeconds = classBasedResult.timeSeconds;
                    const sectorDistance = model.sectors[currentSectorIdx];
                    speedSource = `S${sectorNum} (${classBasedResult.sourceSttnr} class avg): ${(sectorDistance/1000).toFixed(2)}km ÷ ${sectorTimeSeconds.toFixed(1)}s`;
                }
            }
            
            const lastIntTimeMs = NLS.toNumber(car.LASTIMTIME) ?? getLastIntermediateTimestampMs(car, lastIntNum);
            const sectorDistance = model.sectors[currentSectorIdx];

            if (!Number.isFinite(sectorTimeSeconds) || sectorTimeSeconds <= 0) {
                sectorTimeSeconds = sectorDistance / estimatedSpeedMps;
            }
            
            if (Number.isFinite(sectorTimeSeconds) && sectorTimeSeconds > 0) {
                // Calculate speed from current sector: distance / time
                estimatedSpeedMps = sectorDistance / sectorTimeSeconds;
                
                if (Number.isFinite(lastIntTimeMs) && lastIntTimeMs > 0) {
                    // Interpolate based on elapsed time since last intermediate
                    const elapsedMs = Math.max(0, serverNowMs - lastIntTimeMs);
                    const sectorTimeMs = sectorTimeSeconds * 1000;
                    const progress = NLS.clamp(elapsedMs / sectorTimeMs, 0, 1);
                    lapDistance += progress * sectorDistance;
                } else {
                    // No timestamp available, assume halfway through sector
                    lapDistance += 0.5 * sectorDistance;
                }
            }
        }

        // Calculate absolute position including lap count
        const laps = NLS.toNumber(car.LAPS) ?? 0;
        const absoluteProgress = laps * model.trackLength + lapDistance;

        return {
            progress: absoluteProgress,
            lapDistance,
            isExtrapolated: false,
            speedMps: estimatedSpeedMps,
            speedSource: speedSource
        };
    }

    /**
     * Get current server time for position interpolation
     * For replay: adds local elapsed time since payload received
     * For live: uses synced real time
     */
    function getServerNowMs() {
        const state = NLS.state || {};
        const payload = state.latestPayload;
        
        if (payload?.TOD) {
            // For replay: advance time based on local clock progression since payload arrival
            const payloadTimeMs = NLS.toNumber(payload.TOD);
            const payloadReceivedAtMs = state.payloadReceivedAtMs ?? Date.now();
            const elapsedLocalMs = Date.now() - payloadReceivedAtMs;
            
            if (Number.isFinite(payloadTimeMs)) {
                return payloadTimeMs + elapsedLocalMs;
            }
        }
        
        // For live data: use synced real time
        return Date.now() + (state.timeOffsetMs || 0);
    }

    /**
     * Get current sector for a car
     * LASTINTERMEDIATENUMBER: 10 = sector 1, 1-4 = sector 2-5
     */
    function getCurrentSectorAndIntermediate(car, model) {
        if (!model || !car) return null;

        const lastIntNum = NLS.toNumber(car.LASTINTERMEDIATENUMBER) ?? 10;
        
        if (lastIntNum === 10) {
            return { sectorIdx: 1, intermediateIdx: 0 };
        }
        
        if (lastIntNum >= 1 && lastIntNum <= model.cumulative.length) {
            return { sectorIdx: lastIntNum + 1, intermediateIdx: lastIntNum };
        }
        
        // Fallback to sector 1
        return { sectorIdx: 1, intermediateIdx: 0 };
    }

    /**
     * Update progress for all cars on main thread
     */
    function updateAllCarProgress() {
        const state = NLS.state || {};
        const model = getOrCreateModel(state.latestPayload);
        if (!model) return;

        const serverNowMs = getServerNowMs();
        const cars = state.cars || [];

        // Compute all cars on main thread
        const carProgressMap = new Map();
        cars.forEach(car => {
            const stnr = NLS.normalizeText(car.STNR);
            carProgressMap.set(stnr, computeCarProgressMainThread(car, model, serverNowMs));
        });

        state.carProgress = carProgressMap;
    }

    /**
     * Get progress for a car (from state cache)
     */
    function getCarProgress(car) {
        const state = NLS.state || {};
        const stnr = NLS.normalizeText(car.STNR);
        return state.carProgress?.get(stnr) || null;
    }

    /**
     * Public API
     */
    NLS.getTrackModel = getOrCreateModel;
    NLS.getServerNowMs = getServerNowMs;
    NLS.computeCarProgress = computeCarProgressMainThread; // For direct computation if needed
    NLS.updateAllCarProgress = updateAllCarProgress;
    NLS.getCarProgress = getCarProgress;
    NLS.getCurrentSectorAndIntermediate = getCurrentSectorAndIntermediate;

})();
