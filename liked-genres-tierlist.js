(async function LikedGenresTierlist() {
    // 1. Wait for Spicetify APIs to be ready
    while (
        !window.Spicetify ||
        !window.Spicetify.Platform ||
        !window.Spicetify.Platform.History ||
        !window.Spicetify.CosmosAsync ||
        !window.Spicetify.Player ||
        !window.Spicetify.Menu
    ) {
        await new Promise(r => setTimeout(r, 100));
    }

    console.log("LikedGenresTierlist: Spicetify APIs ready.");

    let isExtensionEnabled = localStorage.getItem('lgt:enabled') !== 'false';

    new window.Spicetify.Menu.Item(
        "Genre-Tierliste (Lieblingssongs)",
        isExtensionEnabled,
        (menuItem) => {
            isExtensionEnabled = !isExtensionEnabled;
            localStorage.setItem('lgt:enabled', isExtensionEnabled.toString());
            menuItem.setState(isExtensionEnabled);
            window.Spicetify.showNotification(
                isExtensionEnabled ? "Genre-Tierliste aktiviert! Lade neu..." : "Genre-Tierliste deaktiviert! Lade neu..."
            );
            setTimeout(() => location.reload(), 800);
        }
    ).register();

    new window.Spicetify.Menu.Item(
        "Genre-Tierliste: Genre-Cache leeren & neu laden",
        false,
        async () => {
            await clearGenreDB();
            window.Spicetify.showNotification("Genre-Cache geleert! Lade neu...");
            setTimeout(() => location.reload(), 500);
        }
    ).register();

    new window.Spicetify.Menu.Item(
        "Genre-Tierliste: Benutzerdefinierte Tiers zurücksetzen",
        false,
        async () => {
            await resetCustomTiers();
            window.Spicetify.showNotification("Benutzerdefinierte Tiers zurückgesetzt!");
            if (isViewActive) {
                renderTierlist();
            }
        }
    ).register();

    if (!isExtensionEnabled) {
        console.log("LikedGenresTierlist: Extension is disabled via settings.");
        return;
    }

    // --- DEPENDENCY CHECK ---
    async function checkLikedArtistsViewDependency(quiet = false) {
        if (localStorage.getItem('lav:enabled') === 'false') {
            if (!quiet) {
                window.Spicetify.showNotification(
                    "Genre-Tierliste benötigt 'Künstleransicht (Lieblingssongs)'! Bitte in Spicetify aktivieren.",
                    true
                );
            }
            return false;
        }

        let attempts = 0;
        while (!window.LikedArtistsView && attempts < 25) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }

        if (!window.LikedArtistsView) {
            if (!quiet) {
                window.Spicetify.showNotification(
                    "Genre-Tierliste benötigt die Liked Artists View Extension!",
                    true
                );
            }
            return false;
        }

        return true;
    }

    // --- STYLES ---
    const STYLE_CSS = `
        /* Liked Genres Tierlist Container */
        #lgt-container {
            display: flex;
            flex-direction: column;
            width: 100%;
            min-height: 500px;
            padding: 16px 24px 80px 24px;
            box-sizing: border-box;
            color: var(--text-base, #fff);
            font-family: var(--font-family, spotify-circular, Helvetica, Arial, sans-serif);
            position: relative;
            z-index: 10;
        }

        /* Toggle Button in Action Bar */
        .lgt-toggle-btn {
            background: transparent;
            border: none;
            color: var(--text-subdued, #a7a7a7);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            transition: color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
            margin: 0 6px;
            padding: 0;
            outline: none;
            flex-shrink: 0;
        }
        .lgt-toggle-btn:hover {
            color: var(--text-base, #fff);
            background-color: var(--background-tinted-highlight, rgba(255, 255, 255, 0.1));
            transform: scale(1.08);
        }
        .lgt-toggle-btn.active {
            color: var(--text-bright-accent, #1db954);
        }
        .lgt-toggle-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        /* Header Toolbar */
        .lgt-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .lgt-toolbar-left {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
        }
        .lgt-search-wrapper {
            position: relative;
            display: flex;
            align-items: center;
        }
        .lgt-search-input {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid transparent;
            border-radius: 500px;
            color: #fff;
            padding: 8px 16px 8px 36px;
            font-size: 0.875rem;
            width: 240px;
            transition: all 0.2s ease;
            outline: none;
        }
        .lgt-search-input:focus {
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(255, 255, 255, 0.2);
            width: 280px;
        }
        .lgt-search-icon {
            position: absolute;
            left: 12px;
            pointer-events: none;
            color: var(--text-subdued, #a7a7a7);
        }
        .lgt-stats-badge {
            font-size: 0.875rem;
            color: var(--text-subdued, #a7a7a7);
            font-weight: 500;
        }
        .lgt-toolbar-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .lgt-btn {
            background: rgba(255, 255, 255, 0.08);
            border: none;
            border-radius: 500px;
            color: #fff;
            padding: 6px 14px;
            font-size: 0.8125rem;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: background-color 0.15s ease, transform 0.15s ease;
        }
        .lgt-btn:hover {
            background: rgba(255, 255, 255, 0.16);
            transform: scale(1.03);
        }

        /* Tierlist Structure */
        .lgt-tier-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            width: 100%;
        }

        /* Tier Row */
        .lgt-tier-row {
            display: flex;
            align-items: stretch;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            overflow: hidden;
            min-height: 90px;
            transition: border-color 0.2s ease, background-color 0.2s ease;
        }
        .lgt-tier-row:hover {
            border-color: rgba(255, 255, 255, 0.12);
            background: rgba(255, 255, 255, 0.045);
        }

        /* Tier Header Box (Left) */
        .lgt-tier-header {
            width: 100px;
            min-width: 100px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 12px 8px;
            text-align: center;
            color: #121212;
            font-weight: 800;
            user-select: none;
            box-shadow: 2px 0 8px rgba(0, 0, 0, 0.25);
            flex-shrink: 0;
        }
        .lgt-tier-letter {
            font-size: 2.2rem;
            line-height: 1;
            margin-bottom: 4px;
            text-transform: uppercase;
        }
        .lgt-tier-meta {
            font-size: 0.6875rem;
            font-weight: 700;
            opacity: 0.85;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* Tier Content (Right) */
        .lgt-tier-content {
            flex: 1;
            display: flex;
            flex-wrap: wrap;
            align-content: flex-start;
            gap: 10px;
            padding: 12px 16px;
            min-height: 70px;
        }
        .lgt-tier-empty {
            color: var(--text-subdued, #a7a7a7);
            font-size: 0.875rem;
            font-style: italic;
            display: flex;
            align-items: center;
            padding: 8px;
        }

        /* Genre Card / Chip */
        .lgt-genre-card {
            background: rgba(255, 255, 255, 0.07);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 8px 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 170px;
            max-width: 260px;
            position: relative;
            transition: all 0.2s cubic-bezier(0.3, 0, 0.2, 1);
            cursor: pointer;
            user-select: none;
        }
        .lgt-genre-card:hover {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.22);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        }
        .lgt-genre-card.expanded {
            border-color: var(--text-bright-accent, #1db954);
            background: rgba(255, 255, 255, 0.15);
        }

        .lgt-genre-card-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .lgt-genre-title {
            font-weight: 700;
            font-size: 0.9375rem;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lgt-genre-count {
            background: rgba(255, 255, 255, 0.15);
            color: #ddd;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 12px;
            white-space: nowrap;
        }

        .lgt-genre-artists {
            font-size: 0.75rem;
            color: var(--text-subdued, #a7a7a7);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .lgt-genre-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 4px;
            padding-top: 6px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .lgt-action-btns {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .lgt-icon-btn {
            background: transparent;
            border: none;
            color: var(--text-subdued, #a7a7a7);
            cursor: pointer;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
            padding: 0;
        }
        .lgt-icon-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.15);
            transform: scale(1.1);
        }
        .lgt-icon-btn.play-btn:hover {
            color: #1db954;
        }

        /* Tier Reassign Dropdown */
        .lgt-tier-select {
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 4px;
            color: #fff;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 2px 4px;
            cursor: pointer;
            outline: none;
        }
        .lgt-tier-select:focus {
            border-color: var(--text-bright-accent, #1db954);
        }

        /* Detail Drawer for Songs in Genre */
        .lgt-drawer {
            position: fixed;
            top: 40px; /* Leave space for Spotify's top bar / Windows controls */
            right: 0;
            bottom: 90px;
            width: 440px;
            max-width: 90vw;
            background: #181818;
            box-shadow: -6px 0 24px rgba(0, 0, 0, 0.6);
            border-left: 1px solid rgba(255, 255, 255, 0.1);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            border-top-left-radius: 8px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            transform: translateX(100%);
            transition: transform 0.28s cubic-bezier(0.1, 0.9, 0.2, 1);
        }
        .lgt-drawer.open {
            transform: translateX(0);
        }
        .lgt-drawer-header {
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .lgt-drawer-title-area {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
            flex: 1;
        }
        .lgt-drawer-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lgt-drawer-subtitle {
            font-size: 0.8125rem;
            color: var(--text-subdued, #a7a7a7);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lgt-drawer-close {
            background: transparent;
            border: none;
            color: var(--text-subdued, #a7a7a7);
            font-size: 1.5rem;
            line-height: 1;
            cursor: pointer;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: all 0.15s ease;
        }
        .lgt-drawer-close:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.12);
            transform: scale(1.05);
        }
        .lgt-drawer-controls {
            padding: 12px 24px;
            display: flex;
            gap: 10px;
            background: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .lgt-drawer-content {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
        }
        .lgt-song-row {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            gap: 12px;
            transition: background-color 0.15s ease;
        }
        .lgt-song-row:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .lgt-song-num {
            width: 24px;
            font-size: 0.8125rem;
            color: var(--text-subdued, #a7a7a7);
            text-align: right;
        }
        .lgt-song-cover {
            width: 40px;
            height: 40px;
            border-radius: 4px;
            object-fit: cover;
            background: #282828;
            flex-shrink: 0;
        }
        .lgt-song-info {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .lgt-song-name {
            font-size: 0.875rem;
            font-weight: 600;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lgt-song-artist {
            font-size: 0.75rem;
            color: var(--text-subdued, #a7a7a7);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lgt-song-duration {
            font-size: 0.75rem;
            color: var(--text-subdued, #a7a7a7);
        }

        /* Loading View */
        .lgt-loading-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            text-align: center;
            gap: 16px;
            width: 100%;
        }
        .lgt-spinner {
            width: 44px;
            height: 44px;
            border: 4px solid rgba(255, 255, 255, 0.1);
            border-top: 4px solid var(--text-bright-accent, #1db954);
            border-radius: 50%;
            animation: lgt-spin 0.9s linear infinite;
        }
        @keyframes lgt-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Tier Colors */
        .lgt-tier-s { background-color: #ff7f7f; }
        .lgt-tier-a { background-color: #ffbf7f; }
        .lgt-tier-b { background-color: #ffff7f; }
        .lgt-tier-c { background-color: #7fff7f; }
        .lgt-tier-d { background-color: #7fbfff; }
    `;

    // Inject CSS
    const styleEl = document.createElement("style");
    styleEl.innerHTML = STYLE_CSS;
    document.head.appendChild(styleEl);

    // --- STATE ---
    let isActive = false;
    let isViewActive = localStorage.getItem('lgt:view-active') === 'true';
    let toggleButton = null;
    let toggleButtonTippy = null;
    let customViewContainer = null;
    let drawerContainer = null;
    let allTracks = [];
    let genreMap = [];
    let customTiersMap = new Map(); // genreKey -> "S"|"A"|"B"|"C"|"D"
    let searchQuery = "";
    let selectedGenreForDrawer = null;
    let isLoading = false;
    let domObserver = null;

    // --- SPOTIFY AUTH TOKEN HELPER ---
    async function getSpotifyToken() {
        try {
            if (Spicetify.Platform?.Session?.accessToken) {
                return Spicetify.Platform.Session.accessToken;
            }
        } catch (_) {}
        try {
            if (Spicetify.Platform?.AuthorizationAPI?.getAccessToken) {
                const token = await Spicetify.Platform.AuthorizationAPI.getAccessToken();
                if (token) return token;
            }
        } catch (_) {}
        try {
            if (Spicetify.Platform?.Session?.session?.accessToken) {
                return Spicetify.Platform.Session.session.accessToken;
            }
        } catch (_) {}
        try {
            if (Spicetify.CosmosAsync?.get) {
                const tokenData = await Spicetify.CosmosAsync.get("sp://auth/v2/token");
                if (tokenData?.accessToken) return tokenData.accessToken;
            }
        } catch (_) {}
        return null;
    }

    // --- INDEXEDDB: LikedGenresDB ---
    const DB_NAME = "LikedGenresDB";
    const DB_VERSION = 1;
    let genreDb = null;

    async function initGenreDB() {
        return new Promise((resolve, reject) => {
            const req = window.indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = (e) => {
                genreDb = e.target.result;
                resolve();
            };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("artist_genres")) {
                    db.createObjectStore("artist_genres", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("custom_tiers")) {
                    db.createObjectStore("custom_tiers", { keyPath: "genre" });
                }
                if (!db.objectStoreNames.contains("meta")) {
                    db.createObjectStore("meta", { keyPath: "key" });
                }
            };
        });
    }

    async function getAllArtistGenresFromDB() {
        return new Promise((resolve) => {
            if (!genreDb) return resolve([]);
            try {
                const tx = genreDb.transaction(["artist_genres"], "readonly");
                const store = tx.objectStore("artist_genres");
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch(e) {
                resolve([]);
            }
        });
    }

    async function saveArtistGenresBatchToDB(artistsList) {
        return new Promise((resolve) => {
            if (!genreDb || !artistsList.length) return resolve();
            try {
                const tx = genreDb.transaction(["artist_genres"], "readwrite");
                const store = tx.objectStore("artist_genres");
                artistsList.forEach(a => {
                    store.put({
                        id: a.id,
                        name: a.name || "",
                        genres: a.genres || [],
                        images: a.images || [],
                        updatedAt: Date.now()
                    });
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch(e) {
                resolve();
            }
        });
    }

    async function loadCustomTiersFromDB() {
        return new Promise((resolve) => {
            if (!genreDb) return resolve();
            try {
                const tx = genreDb.transaction(["custom_tiers"], "readonly");
                const store = tx.objectStore("custom_tiers");
                const req = store.getAll();
                req.onsuccess = () => {
                    customTiersMap.clear();
                    (req.result || []).forEach(item => {
                        customTiersMap.set(item.genre, item.tier);
                    });
                    resolve();
                };
                req.onerror = () => resolve();
            } catch(e) {
                resolve();
            }
        });
    }

    async function saveCustomTier(genre, tier) {
        customTiersMap.set(genre, tier);
        if (!genreDb) return;
        try {
            const tx = genreDb.transaction(["custom_tiers"], "readwrite");
            const store = tx.objectStore("custom_tiers");
            store.put({ genre, tier, updatedAt: Date.now() });
        } catch(e) {}
    }

    async function resetCustomTiers() {
        customTiersMap.clear();
        if (!genreDb) return;
        try {
            const tx = genreDb.transaction(["custom_tiers"], "readwrite");
            const store = tx.objectStore("custom_tiers");
            store.clear();
        } catch(e) {}
    }

    async function clearGenreDB() {
        if (!genreDb) return;
        try {
            const tx = genreDb.transaction(["artist_genres", "meta"], "readwrite");
            tx.objectStore("artist_genres").clear();
            tx.objectStore("meta").clear();
        } catch(e) {}
    }

    // --- SPOTIFY GENRE FETCHER ---
    function extractSpotifyArtistId(str) {
        if (!str || typeof str !== 'string') return null;
        const match = str.match(/spotify:artist:([a-zA-Z0-9]+)/);
        if (match) return match[1];
        if (/^[a-zA-Z0-9]{15,35}$/.test(str.trim())) return str.trim();
        return null;
    }

    function fetchWithTimeout(promise, ms = 5000) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
        ]);
    }

    async function fetchArtistBatch(chunk, token) {
        if (!chunk || !chunk.length) return [];
        const ids = chunk.join(',');

        // 1. Spicetify.CosmosAsync with direct URL (uses Spotify's native authenticated internal bridge)
        try {
            if (Spicetify.CosmosAsync?.get) {
                const res = await fetchWithTimeout(Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/artists?ids=${ids}`), 4000);
                if (res?.artists && Array.isArray(res.artists)) {
                    return res.artists.filter(Boolean);
                }
            }
        } catch(e) {
            console.warn("CosmosAsync artists error:", e);
        }

        // 2. Direct fetch with bearer token
        try {
            const authToken = token || await getSpotifyToken();
            if (authToken) {
                const resp = await fetchWithTimeout(fetch(`https://api.spotify.com/v1/artists?ids=${ids}`, {
                    headers: { "Authorization": `Bearer ${authToken}` }
                }), 5000);

                if (resp.status === 429) {
                    const retrySec = parseInt(resp.headers.get("Retry-After") || "3", 10);
                    console.warn(`[LikedGenresTierlist] Rate limit (429)! Warte ${retrySec} Sekunden...`);
                    await new Promise(r => setTimeout(r, (retrySec + 1) * 1000));
                    // Einmaliger Retry nach dem Warten
                    const retryResp = await fetchWithTimeout(fetch(`https://api.spotify.com/v1/artists?ids=${ids}`, {
                        headers: { "Authorization": `Bearer ${authToken}` }
                    }), 5000);
                    if (retryResp.ok) {
                        const data = await retryResp.json();
                        if (data?.artists && Array.isArray(data.artists)) {
                            return data.artists.filter(Boolean);
                        }
                    }
                } else if (resp.ok) {
                    const data = await resp.json();
                    if (data?.artists && Array.isArray(data.artists)) {
                        return data.artists.filter(Boolean);
                    }
                }
            }
        } catch(e) {
            console.warn("Direct fetch artists error:", e);
        }

        return [];
    }

    async function fetchGenresForArtists(artistIds, onProgress) {
        const uniqueIds = Array.from(new Set(artistIds.map(extractSpotifyArtistId).filter(Boolean)));
        const cachedList = await getAllArtistGenresFromDB();
        const cachedMap = new Map(cachedList.map(a => [a.id, a]));

        const now = Date.now();
        const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage gültig

        const missingIds = [];
        uniqueIds.forEach(id => {
            const cached = cachedMap.get(id);
            // Re-fetch if not cached or expired
            if (!cached || !cached.updatedAt || (now - cached.updatedAt > TTL_MS)) {
                missingIds.push(id);
            }
        });

        console.log(`LikedGenresTierlist: Total artists=${uniqueIds.length}, missing/needing fetch=${missingIds.length}`);

        if (missingIds.length > 0) {
            const token = await getSpotifyToken();
            const BATCH_SIZE = 50;
            const newFetchedArtists = [];

            for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
                const chunk = missingIds.slice(i, i + BATCH_SIZE);
                if (onProgress) {
                    onProgress(i, missingIds.length);
                }

                try {
                    const artists = await fetchArtistBatch(chunk, token);
                    if (artists && Array.isArray(artists)) {
                        artists.forEach(a => {
                            if (a && a.id) {
                                const entry = {
                                    id: a.id,
                                    name: a.name || "",
                                    genres: Array.isArray(a.genres) ? a.genres : [],
                                    images: Array.isArray(a.images) ? a.images : []
                                };
                                newFetchedArtists.push(entry);
                                cachedMap.set(a.id, {
                                    ...entry,
                                    updatedAt: now
                                });
                            }
                        });
                    }
                } catch(err) {
                    console.warn("LikedGenresTierlist: Batch fetch error", err);
                }

                // Periodic save to IndexedDB so progress is preserved even if interrupted
                if (newFetchedArtists.length >= 100) {
                    await saveArtistGenresBatchToDB(newFetchedArtists);
                    newFetchedArtists.length = 0;
                }

                if (onProgress) {
                    onProgress(Math.min(i + BATCH_SIZE, missingIds.length), missingIds.length);
                }

                await new Promise(r => setTimeout(r, 180));
            }

            if (newFetchedArtists.length > 0) {
                await saveArtistGenresBatchToDB(newFetchedArtists);
                console.log(`LikedGenresTierlist: Saved remaining artists to IndexedDB.`);
            }
        }

        if (onProgress) onProgress(uniqueIds.length, uniqueIds.length);
        return cachedMap;
    }

    // --- AGGREGATION & TIER ENGINE ---
    function formatGenreName(str) {
        if (!str) return "Unbekannt";
        return str
            .split(/[\s-]+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    function processGenreData(tracks, artistGenresMap) {
        const map = new Map();

        tracks.forEach(track => {
            const artistIds = [];
            const mainId = extractSpotifyArtistId(track.artistUri);
            if (mainId) artistIds.push(mainId);

            if (track.artists && Array.isArray(track.artists)) {
                track.artists.forEach(a => {
                    const aId = extractSpotifyArtistId(a.uri || a.id);
                    if (aId && !artistIds.includes(aId)) artistIds.push(aId);
                });
            }

            const trackGenres = new Set();
            artistIds.forEach(id => {
                const artistObj = artistGenresMap.get(id);
                if (artistObj && Array.isArray(artistObj.genres)) {
                    artistObj.genres.forEach(g => {
                        if (g && g.trim()) trackGenres.add(g.trim().toLowerCase());
                    });
                }
            });

            if (trackGenres.size === 0) {
                trackGenres.add("uncategorized");
            }

            trackGenres.forEach(genreKey => {
                if (!map.has(genreKey)) {
                    map.set(genreKey, {
                        key: genreKey,
                        displayName: genreKey === "uncategorized" ? "Uncategorized / Nische" : formatGenreName(genreKey),
                        tracks: [],
                        artistCounts: new Map()
                    });
                }

                const item = map.get(genreKey);
                item.tracks.push(track);

                const primaryArtist = track.artistName || (track.artists && track.artists[0]?.name) || "Unknown";
                item.artistCounts.set(primaryArtist, (item.artistCounts.get(primaryArtist) || 0) + 1);
            });
        });

        const genresList = Array.from(map.values()).map(item => {
            const sortedArtists = Array.from(item.artistCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(e => e[0]);

            return {
                key: item.key,
                displayName: item.displayName,
                count: item.tracks.length,
                tracks: item.tracks,
                topArtists: sortedArtists.join(", ")
            };
        });

        // Sortiere: echte Genres zuerst nach Song-Anzahl absteigend, "uncategorized" ans Ende
        genresList.sort((a, b) => {
            if (a.key === "uncategorized") return 1;
            if (b.key === "uncategorized") return -1;
            return b.count - a.count;
        });

        return genresList;
    }

    function computeTiers(genresList) {
        const tiers = [
            { id: "S", label: "S-Tier", colorClass: "lgt-tier-s", genres: [] },
            { id: "A", label: "A-Tier", colorClass: "lgt-tier-a", genres: [] },
            { id: "B", label: "B-Tier", colorClass: "lgt-tier-b", genres: [] },
            { id: "C", label: "C-Tier", colorClass: "lgt-tier-c", genres: [] },
            { id: "D", label: "D-Tier", colorClass: "lgt-tier-d", genres: [] }
        ];

        const tierMap = new Map(tiers.map(t => [t.id, t]));

        let filtered = genresList;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = genresList.filter(g =>
                g.displayName.toLowerCase().includes(q) ||
                g.topArtists.toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) return tiers;

        // Finde maximale Song-Anzahl von echten Genres
        const realGenres = genresList.filter(g => g.key !== "uncategorized");
        const maxSongs = realGenres[0] ? realGenres[0].count : 1;
        const totalReal = realGenres.length || 1;

        filtered.forEach((genre) => {
            // Uncategorized immer in D-Tier einordnen
            if (genre.key === "uncategorized") {
                tierMap.get("D").genres.push(genre);
                return;
            }

            // Manuelle Zuweisung prüfen
            if (customTiersMap.has(genre.key)) {
                const assigned = customTiersMap.get(genre.key);
                if (tierMap.has(assigned)) {
                    tierMap.get(assigned).genres.push(genre);
                    return;
                }
            }

            const indexInReal = realGenres.indexOf(genre);
            const percentile = indexInReal >= 0 ? indexInReal / totalReal : 1;

            if (indexInReal === 0 || percentile <= 0.05 || genre.count >= Math.max(30, maxSongs * 0.55)) {
                tierMap.get("S").genres.push(genre);
            } else if (percentile <= 0.20 || genre.count >= Math.max(15, maxSongs * 0.30)) {
                tierMap.get("A").genres.push(genre);
            } else if (percentile <= 0.50 || genre.count >= Math.max(6, maxSongs * 0.15)) {
                tierMap.get("B").genres.push(genre);
            } else if (percentile <= 0.80 || genre.count >= 3) {
                tierMap.get("C").genres.push(genre);
            } else {
                tierMap.get("D").genres.push(genre);
            }
        });

        return tiers;
    }

    // --- PLAYBACK ENGINE ---
    async function playGenreSongs(genreKey, shuffle = false, startUri = null) {
        const item = genreMap.find(g => g.key === genreKey);
        if (!item || !item.tracks || item.tracks.length === 0) {
            window.Spicetify.showNotification("Keine Songs in diesem Genre vorhanden", true);
            return;
        }

        const uris = item.tracks.map(t => t.uri).filter(u => u && !u.startsWith('spotify:local:'));
        if (uris.length === 0) {
            window.Spicetify.showNotification("Keine abspielbaren Songs gefunden", true);
            return;
        }

        let firstTrack = uris[0];
        let queueList = [];

        if (startUri && uris.includes(startUri)) {
            firstTrack = startUri;
            if (shuffle) {
                const remaining = uris.filter(u => u !== startUri);
                queueList = shuffleArray(remaining);
            } else {
                const idx = uris.indexOf(startUri);
                queueList = uris.slice(idx + 1);
            }
        } else {
            if (shuffle) {
                const shuffled = shuffleArray(uris);
                firstTrack = shuffled[0];
                queueList = shuffled.slice(1);
            } else {
                firstTrack = uris[0];
                queueList = uris.slice(1);
            }
        }

        try {
            if (Spicetify.Platform?.PlayerAPI?.play) {
                await Spicetify.Platform.PlayerAPI.play({ uri: firstTrack }, {}, {});
            } else if (Spicetify.Player?.playUri) {
                await Spicetify.Player.playUri(firstTrack);
            }

            if (typeof Spicetify.Player?.setShuffle === 'function') {
                Spicetify.Player.setShuffle(shuffle);
            }

            if (queueList.length > 0 && typeof Spicetify.addToQueue === 'function') {
                const queueItems = queueList.slice(0, 100).map(u => ({ uri: u }));
                await Spicetify.addToQueue(queueItems);
            }

            const notif = shuffle 
                ? `Spielt Genre: ${item.displayName} (Zufall · ${uris.length} Songs)`
                : `Spielt Genre: ${item.displayName} (${uris.length} Songs)`;
            window.Spicetify.showNotification(notif, false);
        } catch (e) {
            console.error("LikedGenresTierlist: Playback error", e);
            if (Spicetify.Player?.playUri) {
                Spicetify.Player.playUri(firstTrack);
            }
        }
    }

    function shuffleArray(arr) {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    function formatDuration(ms) {
        if (!ms) return "0:00";
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    }

    function escapeHtml(unsafe) {
        return (unsafe == null ? "" : unsafe.toString())
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // --- UI RENDERING & CONTAINER MOUNTING ---
    function ensureCustomContainer() {
        if (Spicetify.Platform.History.location.pathname !== "/collection/tracks") {
            return null;
        }

        const mainContainer = document.querySelector('.main-view-container main') ||
                              document.querySelector('main') ||
                              document.querySelector('.main-view-container');
        if (!mainContainer) return null;

        const playlistPage = mainContainer.querySelector('section[data-testid="playlist-page"]') ||
                             mainContainer.querySelector('section[role="presentation"]') ||
                             mainContainer;

        const trackList = playlistPage.querySelector('.main-trackList-trackList') ||
                          playlistPage.querySelector('[data-testid="playlist-tracklist"]') ||
                          playlistPage.querySelector('[role="grid"]:not([aria-label*="Bibliothek"]):not([aria-label*="Library"])');

        if (!customViewContainer) {
            customViewContainer = document.createElement('div');
            customViewContainer.id = 'lgt-container';
        }

        const parent = trackList ? trackList.parentElement : (playlistPage.querySelector('.contentSpacing') || playlistPage);
        if (!parent) return null;

        if (!parent.contains(customViewContainer)) {
            if (trackList && trackList.parentElement === parent) {
                parent.insertBefore(customViewContainer, trackList);
            } else {
                parent.appendChild(customViewContainer);
            }
        }

        customViewContainer.style.display = isViewActive ? '' : 'none';
        return customViewContainer;
    }

    function renderLoadingView(text, percent = -1) {
        const container = ensureCustomContainer();
        if (!container) return;

        const progressHtml = percent >= 0 ? `
            <div style="width: 280px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-top: 10px;">
                <div style="width: ${percent}%; height: 100%; background: #1db954; transition: width 0.15s ease;"></div>
            </div>
            <div style="font-size: 0.8125rem; color: #a7a7a7; margin-top: 6px; font-weight: 600;">${percent}% analysiert</div>
        ` : '';

        container.innerHTML = `
            <div class="lgt-loading-view">
                <div class="lgt-spinner"></div>
                <h2>Genre-Tierliste wird erstellt...</h2>
                <p style="color: #a7a7a7; max-width: 480px; margin: 0; line-height: 1.5;">${escapeHtml(text || "Analysiere Künstler und Genres deiner Lieblingssongs...")}</p>
                ${progressHtml}
            </div>
        `;
    }

    function renderTierlist() {
        const container = ensureCustomContainer();
        if (!container) return;

        const tiers = computeTiers(genreMap);
        const totalRealGenres = genreMap.filter(g => g.key !== "uncategorized").length;
        const totalSongs = allTracks.length;

        let tiersHtml = '';
        tiers.forEach(tier => {
            let cardsHtml = '';
            if (tier.genres.length === 0) {
                cardsHtml = `<div class="lgt-tier-empty">Keine Genres in dieser Stufe</div>`;
            } else {
                tier.genres.forEach(g => {
                    const isExpanded = selectedGenreForDrawer && selectedGenreForDrawer.key === g.key;
                    cardsHtml += `
                        <div class="lgt-genre-card ${isExpanded ? 'expanded' : ''}" data-genre-key="${escapeHtml(g.key)}">
                            <div class="lgt-genre-card-top">
                                <span class="lgt-genre-title" title="${escapeHtml(g.displayName)}">${escapeHtml(g.displayName)}</span>
                                <span class="lgt-genre-count">${g.count}</span>
                            </div>
                            <div class="lgt-genre-artists" title="${escapeHtml(g.topArtists)}">${escapeHtml(g.topArtists)}</div>
                            <div class="lgt-genre-actions">
                                <div class="lgt-action-btns">
                                    <button class="lgt-icon-btn play-btn" data-action="play" data-genre-key="${escapeHtml(g.key)}" title="Genre abspielen">
                                        <svg height="14" width="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                    </button>
                                    <button class="lgt-icon-btn" data-action="shuffle" data-genre-key="${escapeHtml(g.key)}" title="Genre im Shuffle abspielen">
                                        <svg height="14" width="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                                    </button>
                                    <button class="lgt-icon-btn" data-action="drawer" data-genre-key="${escapeHtml(g.key)}" title="Songs anzeigen">
                                        <svg height="14" width="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 18h16c.55 0 1-.45 1-1s-.45-1-1-1H4c-.55 0-1 .45-1 1s.45 1 1 1zm0-5h16c.55 0 1-.45 1-1s-.45-1-1-1H4c-.55 0-1 .45-1 1s.45 1 1 1zM3 7c0 .55.45 1 1 1h16c.55 0 1-.45 1-1s-.45-1-1-1H4c-.55 0-1 .45-1 1z"/></svg>
                                    </button>
                                </div>
                                <select class="lgt-tier-select" data-genre-key="${escapeHtml(g.key)}" title="Tier manuell ändern">
                                    <option value="S" ${tier.id === 'S' ? 'selected' : ''}>S</option>
                                    <option value="A" ${tier.id === 'A' ? 'selected' : ''}>A</option>
                                    <option value="B" ${tier.id === 'B' ? 'selected' : ''}>B</option>
                                    <option value="C" ${tier.id === 'C' ? 'selected' : ''}>C</option>
                                    <option value="D" ${tier.id === 'D' ? 'selected' : ''}>D</option>
                                </select>
                            </div>
                        </div>
                    `;
                });
            }

            tiersHtml += `
                <div class="lgt-tier-row">
                    <div class="lgt-tier-header ${tier.colorClass}">
                        <div class="lgt-tier-letter">${tier.id}</div>
                        <div class="lgt-tier-meta">${tier.genres.length} Genres</div>
                    </div>
                    <div class="lgt-tier-content">${cardsHtml}</div>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="lgt-toolbar">
                <div class="lgt-toolbar-left">
                    <div class="lgt-search-wrapper">
                        <svg class="lgt-search-icon" height="16" width="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2a8 8 0 015.292 13.998l5.354 5.354-1.414 1.414-5.354-5.354A8 8 0 1110 2zm0 2a6 6 0 100 12 6 6 0 000-12z"/></svg>
                        <input type="text" class="lgt-search-input" placeholder="Genre oder Künstler suchen..." value="${escapeHtml(searchQuery)}" />
                    </div>
                    <div class="lgt-stats-badge">
                        🏆 ${totalSongs.toLocaleString()} Songs in ${totalRealGenres} Genres analysiert
                    </div>
                </div>
                <div class="lgt-toolbar-actions">
                    <button class="lgt-btn" id="lgt-rescan-btn" title="Aktualisiere Lieblingssongs & Genres">
                        <svg height="14" width="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                        Neu analysieren
                    </button>
                </div>
            </div>
            <div class="lgt-tier-list">
                ${tiersHtml}
            </div>
        `;

        // Event Listeners
        const searchInput = container.querySelector('.lgt-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                renderTierlist();
                const newInput = container.querySelector('.lgt-search-input');
                if (newInput) {
                    newInput.focus();
                    newInput.setSelectionRange(searchQuery.length, searchQuery.length);
                }
            });
        }

        const rescanBtn = container.querySelector('#lgt-rescan-btn');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', async () => {
                window.Spicetify.showNotification("Lösche Cache & starte Analyse neu...");
                await clearGenreDB();
                await loadData(true);
            });
        }

        // Tier Change Dropdowns
        container.querySelectorAll('.lgt-tier-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                e.stopPropagation();
                const gKey = sel.getAttribute('data-genre-key');
                const newTier = e.target.value;
                await saveCustomTier(gKey, newTier);
                renderTierlist();
            });
        });

        // Genre Card Buttons
        container.querySelectorAll('.lgt-genre-card').forEach(card => {
            card.addEventListener('click', () => {
                const gKey = card.getAttribute('data-genre-key');
                openGenreDrawer(gKey);
            });
        });

        container.querySelectorAll('.lgt-icon-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                const gKey = btn.getAttribute('data-genre-key');
                if (action === 'play') {
                    playGenreSongs(gKey, false);
                } else if (action === 'shuffle') {
                    playGenreSongs(gKey, true);
                } else if (action === 'drawer') {
                    openGenreDrawer(gKey);
                }
            });
        });
    }

    // --- SONG DRAWER FOR GENRE ---
    function ensureDrawer() {
        if (!drawerContainer) {
            drawerContainer = document.createElement('div');
            drawerContainer.className = 'lgt-drawer';
            document.body.appendChild(drawerContainer);
        }
    }

    function openGenreDrawer(genreKey) {
        ensureDrawer();
        const item = genreMap.find(g => g.key === genreKey);
        if (!item) return;

        selectedGenreForDrawer = item;

        let songsListHtml = '';
        item.tracks.forEach((track, i) => {
            const cover = track.albumImage || "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="4" fill="#282828"/></svg>');
            songsListHtml += `
                <div class="lgt-song-row" data-uri="${escapeHtml(track.uri)}">
                    <span class="lgt-song-num">${i + 1}</span>
                    <img class="lgt-song-cover" src="${escapeHtml(cover)}" loading="lazy" />
                    <div class="lgt-song-info">
                        <span class="lgt-song-name">${escapeHtml(track.name)}</span>
                        <span class="lgt-song-artist">${escapeHtml(track.artistName || "Unknown")} · ${escapeHtml(track.albumName || "")}</span>
                    </div>
                    <span class="lgt-song-duration">${formatDuration(track.durationMs)}</span>
                </div>
            `;
        });

        drawerContainer.innerHTML = `
            <div class="lgt-drawer-header">
                <div class="lgt-drawer-title-area">
                    <div class="lgt-drawer-title">${escapeHtml(item.displayName)}</div>
                    <div class="lgt-drawer-subtitle">${item.tracks.length} Songs · ${escapeHtml(item.topArtists)}</div>
                </div>
                <button class="lgt-drawer-close" title="Schließen">&times;</button>
            </div>
            <div class="lgt-drawer-controls">
                <button class="lgt-btn" id="lgt-drawer-play-all">
                    <svg height="14" width="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    Alle abspielen
                </button>
                <button class="lgt-btn" id="lgt-drawer-shuffle-all">
                    <svg height="14" width="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                    Zufall
                </button>
            </div>
            <div class="lgt-drawer-content">
                ${songsListHtml}
            </div>
        `;

        drawerContainer.querySelector('.lgt-drawer-close').addEventListener('click', closeGenreDrawer);
        drawerContainer.querySelector('#lgt-drawer-play-all').addEventListener('click', () => {
            playGenreSongs(item.key, false);
        });
        drawerContainer.querySelector('#lgt-drawer-shuffle-all').addEventListener('click', () => {
            playGenreSongs(item.key, true);
        });

        drawerContainer.querySelectorAll('.lgt-song-row').forEach(row => {
            row.addEventListener('click', () => {
                const uri = row.getAttribute('data-uri');
                playGenreSongs(item.key, false, uri);
            });
        });

        requestAnimationFrame(() => {
            drawerContainer.classList.add('open');
        });
    }

    function closeGenreDrawer() {
        if (drawerContainer) {
            drawerContainer.classList.remove('open');
        }
        selectedGenreForDrawer = null;
    }

    // --- DATA LOADING ORCHESTRATION ---
    async function loadData(forceRefresh = false) {
        if (isLoading) return;
        isLoading = true;

        try {
            ensureCustomContainer();
            renderLoadingView("Lese Songs aus Liked Artists Datenbank...");

            // 1. Dependency check
            const ok = await checkLikedArtistsViewDependency();
            if (!ok) {
                isLoading = false;
                return;
            }

            if (!genreDb) await initGenreDB();
            await loadCustomTiersFromDB();

            // 2. Tracks aus LikedArtistsViewDB laden
            let tracks = [];
            if (window.LikedArtistsView?.getAllTracksFromDB) {
                try {
                    tracks = await window.LikedArtistsView.getAllTracksFromDB();
                } catch(e) {}
            }

            // Fallback auf IndexedDB direkt mit Version 4
            if (!tracks || tracks.length === 0) {
                tracks = await new Promise((resolve) => {
                    const req = window.indexedDB.open("LikedArtistsViewDB", 4);
                    req.onsuccess = (e) => {
                        const db = e.target.result;
                        if (db.objectStoreNames.contains("tracks")) {
                            const tx = db.transaction(["tracks"], "readonly");
                            const r = tx.objectStore("tracks").getAll();
                            r.onsuccess = () => resolve(r.result || []);
                            r.onerror = () => resolve([]);
                        } else resolve([]);
                    };
                    req.onerror = () => resolve([]);
                });
            }

            if (!tracks || tracks.length === 0) {
                renderLoadingView("Lade Lieblingssongs von Spotify... (Liked Artists View synchronisiert)");
                if (window.LikedArtistsView?.loadData) {
                    await window.LikedArtistsView.loadData();
                    tracks = await window.LikedArtistsView.getAllTracksFromDB();
                }
            }

            allTracks = tracks || [];

            if (allTracks.length === 0) {
                const container = ensureCustomContainer();
                if (container) {
                    container.innerHTML = `
                        <div class="lgt-loading-view">
                            <h2>Keine gelikten Songs gefunden</h2>
                            <p style="color: #a7a7a7;">Füge Songs zu deinen Lieblingssongs hinzu und öffne die Ansicht erneut.</p>
                        </div>
                    `;
                }
                isLoading = false;
                return;
            }

            // 3. Künstler-IDs sammeln
            const artistIds = [];
            allTracks.forEach(t => {
                const mainId = extractSpotifyArtistId(t.artistUri);
                if (mainId) artistIds.push(mainId);

                if (t.artists && Array.isArray(t.artists)) {
                    t.artists.forEach(a => {
                        const aId = extractSpotifyArtistId(a.uri || a.id);
                        if (aId && !artistIds.includes(aId)) artistIds.push(aId);
                    });
                }
            });

            // 4. Genres von Spotify abrufen & cachen (mit Authentifizierung)
            renderLoadingView(`Lade Künstler-Genres (${artistIds.length} Songs)...`, 0);
            const artistGenresMap = await fetchGenresForArtists(artistIds, (cur, tot) => {
                const pct = tot > 0 ? Math.round((cur / tot) * 100) : 0;
                renderLoadingView(`Analysiere Künstler (${cur.toLocaleString()} / ${tot.toLocaleString()})...`, pct);
            });

            // 5. Daten aggregieren
            genreMap = processGenreData(allTracks, artistGenresMap);

            // 6. UI rendern
            renderTierlist();
        } catch(err) {
            console.error("LikedGenresTierlist: Error in loadData", err);
            const container = ensureCustomContainer();
            if (container) {
                container.innerHTML = `
                    <div class="lgt-loading-view" style="color: #ff5555;">
                        <h2>Fehler beim Erstellen der Genre-Tierliste</h2>
                        <p style="color: #aaa;">${escapeHtml(err.message || err)}</p>
                    </div>
                `;
            }
        } finally {
            isLoading = false;
        }
    }

    // --- TOGGLE BUTTON & VIEW MANAGEMENT ---
    function updateToggleButtonState() {
        if (!toggleButton) return;
        toggleButton.classList.toggle('active', isViewActive);

        const tooltip = isViewActive
            ? "Genre-Tierliste aktiv (Klicken für Standard-Songliste)"
            : "Genre-Tierliste (Lieblingssongs)";

        toggleButton.setAttribute('aria-label', tooltip);

        if (window.Spicetify?.Tippy) {
            if (!toggleButtonTippy) {
                toggleButtonTippy = Spicetify.Tippy(toggleButton, {
                    ...(Spicetify.TippyProps || {}),
                    content: tooltip,
                    placement: 'top',
                });
            } else {
                toggleButtonTippy.setContent(tooltip);
            }
        } else {
            toggleButton.setAttribute('title', tooltip);
        }
    }

    function toggleGenreView() {
        isViewActive = !isViewActive;
        localStorage.setItem('lgt:view-active', isViewActive.toString());
        updateToggleButtonState();

        if (isViewActive) {
            if (window.LikedArtistsView?.setArtistViewActive) {
                window.LikedArtistsView.setArtistViewActive(false, true);
            }

            document.body.classList.add('lav-hide-native', 'lgt-active');
            window.dispatchEvent(new CustomEvent('lgt:view-changed', { detail: { isGenreViewActive: true } }));

            const container = ensureCustomContainer();
            if (container) {
                container.style.display = '';
            }

            if (!genreMap || genreMap.length === 0) {
                loadData();
            } else {
                renderTierlist();
            }
            window.Spicetify.showNotification("Genre-Tierliste aktiviert", false);
        } else {
            document.body.classList.remove('lgt-active');
            if (!localStorage.getItem('lav:view-active') || localStorage.getItem('lav:view-active') === 'false') {
                document.body.classList.remove('lav-hide-native');
            }

            window.dispatchEvent(new CustomEvent('lgt:view-changed', { detail: { isGenreViewActive: false } }));

            if (customViewContainer) {
                customViewContainer.style.display = 'none';
            }
            closeGenreDrawer();
            window.Spicetify.showNotification("Standard-Songliste aktiviert", false);
        }
    }

    // Listen to LAV events
    window.addEventListener('lav:view-changed', (e) => {
        if (e.detail && e.detail.isArtistViewActive) {
            if (isViewActive) {
                isViewActive = false;
                localStorage.setItem('lgt:view-active', 'false');
                updateToggleButtonState();
                if (customViewContainer) {
                    customViewContainer.style.display = 'none';
                }
                closeGenreDrawer();
            }
        }
    });

    function createOrUpdateToggleButton() {
        if (Spicetify.Platform.History.location.pathname !== "/collection/tracks") {
            if (toggleButton && toggleButton.parentElement) {
                toggleButton.parentElement.removeChild(toggleButton);
            }
            return;
        }

        const actionBar = document.querySelector('.main-actionBar-ActionBarRow') ||
                          document.querySelector('[data-testid="action-bar-row"]') ||
                          document.querySelector('.main-actionBar-ActionBar');

        if (!actionBar) return;

        if (!toggleButton) {
            toggleButton = document.createElement('button');
            toggleButton.className = 'lgt-toggle-btn' + (isViewActive ? ' active' : '');
            toggleButton.setAttribute('type', 'button');
            toggleButton.innerHTML = `
                <svg role="img" height="20" width="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 17h18v3H3v-3zm3-6h12v3H6v-3zm3-6h6v3H9V5z"/>
                </svg>
            `;
            toggleButton.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleGenreView();
            });
        }

        updateToggleButtonState();

        const lavBtn = actionBar.querySelector('.lav-toggle-btn');
        if (lavBtn && lavBtn.parentElement) {
            if (toggleButton.previousElementSibling !== lavBtn) {
                lavBtn.parentElement.insertBefore(toggleButton, lavBtn.nextSibling);
            }
        } else if (!actionBar.contains(toggleButton)) {
            actionBar.appendChild(toggleButton);
        }
    }

    let activateRetries = 0;
    let activateRetryTimeout = null;

    function scheduleActivateRetry() {
        if (activateRetryTimeout) clearTimeout(activateRetryTimeout);
        if (activateRetries >= 80) return;
        activateRetries++;
        activateRetryTimeout = setTimeout(() => {
            if (Spicetify.Platform.History.location.pathname === "/collection/tracks") {
                activate();
            }
        }, 40);
    }

    function activate() {
        if (Spicetify.Platform.History.location.pathname !== "/collection/tracks") {
            deactivate();
            return;
        }

        createOrUpdateToggleButton();

        const container = ensureCustomContainer();
        if (!container) {
            scheduleActivateRetry();
            return;
        }

        activateRetries = 0;
        isActive = true;

        if (isViewActive) {
            document.body.classList.add('lav-hide-native', 'lgt-active');
            container.style.display = '';
            if (!genreMap || genreMap.length === 0) {
                loadData();
            } else {
                renderTierlist();
            }
        } else {
            container.style.display = 'none';
        }
    }

    function deactivate() {
        if (activateRetryTimeout) {
            clearTimeout(activateRetryTimeout);
            activateRetryTimeout = null;
        }
        activateRetries = 0;
        isActive = false;

        document.body.classList.remove('lav-hide-native', 'lgt-active');

        if (toggleButton && toggleButton.parentElement) {
            toggleButton.parentElement.removeChild(toggleButton);
        }

        if (customViewContainer && customViewContainer.parentElement) {
            customViewContainer.parentElement.removeChild(customViewContainer);
        }

        closeGenreDrawer();
    }

    function initDOMObserver() {
        if (domObserver) return;
        domObserver = new MutationObserver(() => {
            if (Spicetify.Platform.History.location.pathname === "/collection/tracks") {
                createOrUpdateToggleButton();
                if (isViewActive) {
                    ensureCustomContainer();
                }
            }
        });
        const header = document.querySelector('.main-view-container__scroll-node-child') || document.body;
        domObserver.observe(header, { childList: true, subtree: true });
    }

    // --- NAVIGATION LISTENER ---
    Spicetify.Platform.History.listen((location) => {
        if (location.pathname === "/collection/tracks") {
            activate();
        } else {
            deactivate();
        }
    });

    initDOMObserver();

    // Initial Check
    if (Spicetify.Platform.History.location.pathname === "/collection/tracks") {
        activate();
    } else {
        deactivate();
    }

})();
