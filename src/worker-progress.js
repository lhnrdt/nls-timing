/**
 * Worker for computing car progress on separate threads
 * Each car gets its own persistent worker instance
 */

function normalizeText(t) {
    return String(t ?? '').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

function computeCarProgress(car, model, serverNowMs) {
    if (!model || !car) return null;
    
    let lastIntNum = toNumber(car.LASTINTERMEDIATENUMBER);
    if (!Number.isFinite(lastIntNum)) {
        lastIntNum = 10;
    }
    
    let lapDistance = 0;
    let currentSectorIdx = 0;
    
    if (lastIntNum === 10) {
        lapDistance = 0;
        currentSectorIdx = 0;
    } else if (lastIntNum >= 1 && lastIntNum <= model.cumulative.length) {
        lapDistance = model.cumulative[lastIntNum - 1];
        currentSectorIdx = lastIntNum;
    }
    
    if (currentSectorIdx >= 0 && currentSectorIdx < model.sectors.length) {
        let sectorTimeSeconds = null;
        
        // Use average of completed sectors
        const completedTimes = [];
        for (let i = 0; i < currentSectorIdx; i++) {
            const t = parseTime(car['S' + (i + 1) + 'TIME']);
            if (Number.isFinite(t) && t > 0) {
                completedTimes.push(t);
            }
        }
        if (completedTimes.length > 0) {
            sectorTimeSeconds = completedTimes.reduce((a, b) => a + b) / completedTimes.length;
        }
        
        const lastIntTimeMs = toNumber(car.LASTIMTIME);
        const sectorDistance = model.sectors[currentSectorIdx];
        const defaultSpeedMps = 60;

        if (!Number.isFinite(sectorTimeSeconds) || sectorTimeSeconds <= 0) {
            sectorTimeSeconds = sectorDistance / defaultSpeedMps;
        }
        
        if (Number.isFinite(sectorTimeSeconds) && sectorTimeSeconds > 0) {
            if (Number.isFinite(lastIntTimeMs) && lastIntTimeMs > 0) {
                const elapsedMs = Math.max(0, serverNowMs - lastIntTimeMs);
                const sectorTimeMs = sectorTimeSeconds * 1000;
                const progress = clamp(elapsedMs / sectorTimeMs, 0, 1);
                lapDistance += progress * sectorDistance;
            } else {
                lapDistance += 0.5 * sectorDistance;
            }
        }
    }
    
    const laps = toNumber(car.LAPS) ?? 0;
    const absoluteProgress = laps * model.trackLength + lapDistance;
    
    let estimatedSpeedMps = 60; // Default fallback (216 km/h - reasonable for race cars)
    let speedSource = 'Default fallback (60 m/s = 216 km/h)';
    const sectorTimes = [];
    for (let i = 0; i < model.sectors.length; i++) {
        const timeSeconds = parseTime(car['S' + (i + 1) + 'TIME']);
        if (Number.isFinite(timeSeconds) && timeSeconds > 0) {
            sectorTimes.push(timeSeconds);
        }
    }
    if (sectorTimes.length > 0) {
        const avgSectorSeconds = sectorTimes.reduce((a, b) => a + b) / sectorTimes.length;
        const avgSectorMeters = model.sectors[0];
        estimatedSpeedMps = avgSectorMeters / avgSectorSeconds;
        speedSource = `Avg of ${sectorTimes.length} sectors: ${avgSectorMeters.toFixed(0)}m ÷ ${avgSectorSeconds.toFixed(1)}s avg`;
    }
    
    return {
        progress: absoluteProgress,
        lapDistance,
        isExtrapolated: false,
        speedMps: estimatedSpeedMps,
        speedSource: speedSource
    };
}

// Main worker message handler
self.onmessage = function(e) {
    const { car, model, serverNowMs } = e.data;
    const progress = computeCarProgress(car, model, serverNowMs);
    self.postMessage({ progress });
};
