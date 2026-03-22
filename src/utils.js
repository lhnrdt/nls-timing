(() => {
    const NLS = window.NLS || (window.NLS = {});

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
            channel === NLS.MATCH.channel &&
            title.includes(NLS.MATCH.titleContains)
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

    NLS.normalizeText = normalizeText;
    NLS.getTitle = getTitle;
    NLS.getChannel = getChannel;
    NLS.matches = matches;
    NLS.getPlayerContainer = getPlayerContainer;
    NLS.parseTime = parseTime;
    NLS.parseGapSeconds = parseGapSeconds;
    NLS.parseGapLapNumber = parseGapLapNumber;
    NLS.isRetired = isRetired;
    NLS.toNumber = toNumber;
    NLS.clamp = clamp;
})();
