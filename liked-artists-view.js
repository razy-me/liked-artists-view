(async function LikedArtistsView() {
    // 1. Wait for Spicetify APIs to be ready (Only wait for what we actually use)
    while (!window.Spicetify || !window.Spicetify.Platform || !window.Spicetify.Platform.History || !window.Spicetify.CosmosAsync || !window.Spicetify.Player || !window.Spicetify.Menu) {
        await new Promise(r => setTimeout(r, 100));
    }

    console.log("LikedArtistsView: Spicetify APIs ready.");

    let isExtensionEnabled = localStorage.getItem('lav:enabled') !== 'false';

    new window.Spicetify.Menu.Item(
        "Künstleransicht (Lieblingssongs)",
        isExtensionEnabled,
        (menuItem) => {
            isExtensionEnabled = !isExtensionEnabled;
            localStorage.setItem('lav:enabled', isExtensionEnabled.toString());
            menuItem.setState(isExtensionEnabled);
            window.Spicetify.showNotification(isExtensionEnabled ? "Künstleransicht aktiviert! Lade neu..." : "Künstleransicht deaktiviert! Lade neu...");
            setTimeout(() => location.reload(), 800);
        }
    ).register();

    new window.Spicetify.Menu.Item(
        "Künstleransicht: Cache leeren & neu laden",
        false,
        async () => {
            await clearDatabaseAndCache();
            window.Spicetify.showNotification("Cache geleert! Lade neu...");
            setTimeout(() => location.reload(), 500);
        }
    ).register();

    if (!isExtensionEnabled) {
        console.log("LikedArtistsView: Extension is disabled via settings.");
        return; // Stop execution
    }

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Neutral vinyl-style placeholder instead of a hardcoded random cover URL
    const PLACEHOLDER_IMAGE =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="4" fill="#282828"/><circle cx="24" cy="24" r="15" fill="none" stroke="#535353" stroke-width="2"/><circle cx="24" cy="24" r="4" fill="#b3b3b3"/></svg>'
        );

    const STYLE_CSS = `
        /* Container for the custom view */
        #lav-container {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
        }

        /* Virtual Scroll Container */
        .lav-scroll-container {
            overflow-y: auto;
            height: 100%;
            position: relative;
        }

        /* Artist Row (Collapsed) */
        .lav-artist-row {
            display: flex;
            align-items: center;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            transition: background-color 0.2s;
        }
        .lav-artist-row:hover {
            background-color: var(--background-tinted-highlight, rgba(255, 255, 255, 0.1));
        }

        /* Artist Image & Play Button */
        .lav-image-container {
            position: relative;
            width: 48px;
            height: 48px;
            margin-right: 16px;
        }

        .lav-artist-image {
            width: 100%;
            height: 100%;
            border-radius: 4px;
            object-fit: cover;
            transition: opacity 0.3s ease, transform 0.25s ease;
        }

        .lav-play-button {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.85);
            width: 32px;
            height: 32px;
            background-color: rgba(0, 0, 0, 0.7);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s, background-color 0.2s, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            pointer-events: none;
        }

        .lav-image-container:hover .lav-play-button {
            opacity: 1;
            pointer-events: auto;
            cursor: pointer;
            transform: translate(-50%, -50%) scale(1);
        }

        .lav-play-button:hover {
            transform: translate(-50%, -50%) scale(1.1);
            background-color: rgba(0, 0, 0, 0.9);
        }

        .lav-image-container:hover .lav-artist-image {
            transform: scale(1.05);
        }

        .lav-play-button svg {
            width: 16px;
            height: 16px;
            fill: #fff;
            margin-left: 2px;
        }

        .lav-artist-info {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-width: 0;
        }

        .lav-artist-name {
            color: var(--text-base, #fff);
            font-weight: 700;
            font-size: 1rem;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .lav-artist-meta {
            color: var(--text-subdued, #a7a7a7);
            font-size: 0.875rem;
        }

        .lav-chevron {
            color: var(--text-subdued, #a7a7a7);
            margin-left: 16px;
            transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .lav-artist-row[data-expanded="true"] .lav-chevron {
            transform: rotate(90deg);
        }

        /* Loading View */
        .lav-loading-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 48px;
            color: var(--text-subdued, #a7a7a7);
        }

        .lav-progress-bar-container {
            width: 300px;
            height: 4px;
            background-color: var(--background-tinted-base, rgba(255, 255, 255, 0.1));
            border-radius: 2px;
            margin-top: 16px;
            overflow: hidden;
        }

        .lav-progress-bar {
            height: 100%;
            background-color: var(--text-bright-accent, #1db954);
            width: 0%;
            transition: width 0.1s linear;
        }

        /* Indeterminate shimmer while the total count is unknown */
        .lav-progress-bar.indeterminate {
            width: 100% !important;
            background: linear-gradient(90deg, transparent 0%, #1db954 50%, transparent 100%);
            background-size: 200% 100%;
            animation: lav-shimmer 1.2s linear infinite;
            transition: none;
        }
        @keyframes lav-shimmer {
            from { background-position: 200% 0; }
            to   { background-position: -200% 0; }
        }

        /* Scroll Container for Virtual List */
        .lav-scroll-container {
            width: 100%;
            height: calc(100vh - 200px); /* Adjust based on header height */
            overflow-y: auto;
            position: relative;
            padding-bottom: 100px;
        }

        /* Song List Container */
        .lav-songs-list {
            display: flex;
            flex-direction: column;
            padding: 8px 16px 16px 64px;
        }

        /* Song Row */
        .lav-song-row {
            display: flex;
            align-items: center;
            height: 56px;
            padding: 0 16px;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .lav-song-row:hover {
            background-color: var(--background-highlight, rgba(255, 255, 255, 0.1));
        }

        .lav-song-num {
            width: 32px;
            color: var(--text-subdued, #a7a7a7);
            font-size: 0.875rem;
            text-align: right;
            margin-right: 16px;
        }

        .lav-song-cover {
            width: 40px;
            height: 40px;
            border-radius: 4px;
            margin-right: 16px;
            object-fit: cover;
        }

        .lav-song-details {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
        }

        .lav-song-title {
            color: var(--text-base, #fff);
            font-size: 1rem;
            display: flex;
            align-items: center;
            min-width: 0;
        }
        .lav-song-title-text {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .lav-song-row--playing .lav-song-title {
            color: var(--text-bright-accent, #1db954);
        }

        /* Animated equalizer indicator for the playing song */
        .lav-eq {
            display: inline-flex;
            align-items: flex-end;
            gap: 2px;
            height: 12px;
            width: 14px;
            margin-left: 8px;
            flex-shrink: 0;
        }
        .lav-eq span {
            width: 3px;
            background: var(--text-bright-accent, #1db954);
            border-radius: 1px;
            height: 30%;
        }
        .lav-eq span:nth-child(1) { animation: lav-eq-bounce 0.9s ease-in-out infinite alternate; }
        .lav-eq span:nth-child(2) { animation: lav-eq-bounce 1.3s ease-in-out infinite alternate 0.15s; }
        .lav-eq span:nth-child(3) { animation: lav-eq-bounce 1.1s ease-in-out infinite alternate 0.3s; }
        @keyframes lav-eq-bounce {
            from { height: 20%; }
            to   { height: 95%; }
        }

        .lav-song-album {
            color: var(--text-subdued, #a7a7a7);
            font-size: 0.875rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .lav-song-duration {
            color: var(--text-subdued, #a7a7a7);
            font-size: 0.875rem;
            width: 48px;
            text-align: right;
        }

        @media (prefers-reduced-motion: reduce) {
            .lav-song-row,
            .lav-progress-bar.indeterminate,
            .lav-eq span {
                animation: none !important;
            }
        }

        .lav-hide-native .main-trackList-trackListHeader,
        .lav-hide-native .main-trackList-trackList {
            display: none !important;
        }

        /* In-Playlist Toggle Button */
        .lav-toggle-btn {
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
        .lav-toggle-btn:hover {
            color: var(--text-base, #fff);
            background-color: var(--background-tinted-highlight, rgba(255, 255, 255, 0.1));
            transform: scale(1.08);
        }
        .lav-toggle-btn.active {
            color: var(--text-bright-accent, #1db954);
        }
        .lav-toggle-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }
    `;

    // Inject CSS
    const styleEl = document.createElement("style");
    styleEl.innerHTML = STYLE_CSS;
    document.head.appendChild(styleEl);

    // State
    let isActive = false;
    let isViewActive = localStorage.getItem('lav:view-active') !== 'false';
    let toggleButton = null;
    let toggleButtonTippy = null;
    let customViewContainer = null;
    let originalTrackListContainer = null;
    let scrollContainer = null;
    let contentContainer = null;
    let uiAnimationFrame = null;
    let renderData = [];
    let expandedArtists = new Set(); // artistUri
    const ROW_HEIGHT = 64;
    const SONG_ROW_HEIGHT = 56;
    const BUFFER_ROWS = 10;

    function escapeHtml(unsafe) {
        return (unsafe == null ? "" : unsafe.toString())
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    let activateRetries = 0;
    let activateRetryTimeout = null;

    function getToggleTooltipText() {
        return isViewActive 
            ? "Künstleransicht aktiv (Klicken für Standard-Songliste)" 
            : "Standard-Songliste aktiv (Klicken für Künstleransicht)";
    }

    function updateToggleButtonState() {
        if (!toggleButton) return;
        toggleButton.classList.toggle('active', isViewActive);
        const text = getToggleTooltipText();
        toggleButton.setAttribute('aria-label', text);

        if (window.Spicetify && Spicetify.Tippy) {
            if (!toggleButtonTippy) {
                toggleButtonTippy = Spicetify.Tippy(toggleButton, {
                    ...(Spicetify.TippyProps || {}),
                    content: text,
                    placement: 'top',
                });
            } else {
                toggleButtonTippy.setContent(text);
            }
        } else {
            toggleButton.setAttribute('title', text);
        }
    }

    function toggleArtistView() {
        isViewActive = !isViewActive;
        localStorage.setItem('lav:view-active', isViewActive.toString());
        updateToggleButtonState();

        if (isViewActive) {
            document.body.classList.add('lav-hide-native');
            if (customViewContainer) {
                customViewContainer.style.display = '';
                renderVirtualList();
            } else {
                activate();
            }
            window.Spicetify.showNotification("Künstleransicht aktiviert", false);
        } else {
            document.body.classList.remove('lav-hide-native');
            if (customViewContainer) {
                customViewContainer.style.display = 'none';
            }
            window.Spicetify.showNotification("Standard-Songliste aktiviert", false);
        }
    }

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
            toggleButton.className = 'lav-toggle-btn' + (isViewActive ? ' active' : '');
            toggleButton.setAttribute('type', 'button');
            toggleButton.innerHTML = `
                <svg role="img" height="20" width="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
            `;
            toggleButton.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleArtistView();
            });
        }

        updateToggleButtonState();

        if (!actionBar.contains(toggleButton)) {
            const filterBtn = actionBar.querySelector('.x-filterBox-expandButton') || actionBar.querySelector('.x-filterBox-filterInput');
            if (filterBtn) {
                // Find the search box root container inside the action bar / trailing controls
                // so toggleButton is inserted as a true sibling OUTSIDE the search box's tooltip container
                let searchContainer = filterBtn;
                while (
                    searchContainer.parentElement &&
                    searchContainer.parentElement !== actionBar &&
                    !searchContainer.parentElement.querySelector('[data-testid*="sort"], [class*="sortBox"], [class*="Sort"]') &&
                    !searchContainer.parentElement.classList.contains('main-actionBar-ActionBarRow')
                ) {
                    searchContainer = searchContainer.parentElement;
                }

                if (searchContainer && searchContainer.parentElement) {
                    searchContainer.parentElement.insertBefore(toggleButton, searchContainer);
                } else {
                    actionBar.appendChild(toggleButton);
                }
            } else {
                actionBar.appendChild(toggleButton);
            }
        }
    }

    function activate() {
        if (isActive) return;
        if (Spicetify.Platform.History.location.pathname !== "/collection/tracks") {
            return;
        }

        // Instant pre-emptive hide to prevent FOUC
        if (isViewActive) {
            document.body.classList.add('lav-hide-native');
        }

        isActive = true;
        console.log("LikedArtistsView: Activating...");

        createOrUpdateToggleButton();

        const scrollNode = document.querySelector('.main-view-container__scroll-node [data-overlayscrollbars-viewport]') || document.querySelector('.main-view-container__scroll-node');

        if (!scrollNode) {
            scheduleActivateRetry();
            return;
        }

        const trackList = scrollNode.querySelector('.main-trackList-trackList') || document.querySelector('.main-trackList-trackList');
        if (!trackList) {
             scheduleActivateRetry();
             return;
        }

        activateRetries = 0;
        originalTrackListContainer = trackList.closest('.os-content') || trackList.parentElement;

        if (!customViewContainer) {
            customViewContainer = document.createElement('div');
            customViewContainer.id = 'lav-container';
        }

        if (!isViewActive) {
            customViewContainer.style.display = 'none';
        } else {
            customViewContainer.style.display = '';
        }

        trackList.parentElement.insertBefore(customViewContainer, trackList);

        initDOMObserver();
        createOrUpdateToggleButton();

        loadData().then(() => {
            if (isActive) {
                console.log("LikedArtistsView: Data loaded.", cachedArtists.length, "artists.");
            }
        }).catch(err => {
            console.error("LikedArtistsView: Failed to load data", err);
            window.Spicetify.showNotification("Fehler beim Laden: " + (err.message || err), true);
        });
    }

    // Micro-polling retry so the custom view mounts in milliseconds without user-noticeable lag
    function scheduleActivateRetry() {
        if (activateRetryTimeout) clearTimeout(activateRetryTimeout);
        if (activateRetries >= 80) {
            console.warn("LikedArtistsView: Giving up activation after retries.");
            isActive = false;
            return;
        }
        activateRetries++;
        activateRetryTimeout = setTimeout(() => {
            isActive = false;
            if (Spicetify.Platform.History.location.pathname === "/collection/tracks") {
                activate();
            }
        }, 30);
    }

    function deactivate() {
        if (activateRetryTimeout) {
            clearTimeout(activateRetryTimeout);
            activateRetryTimeout = null;
        }
        activateRetries = 0;
        if (!isActive) return;
        isActive = false;
        console.log("LikedArtistsView: Deactivating...");

        if (domObserver) {
            domObserver.disconnect();
            domObserver = null;
        }

        const mainView = document.querySelector('.main-view-container');
        if (mainView) {
            mainView.removeEventListener('input', onSearchInput);
        }

        if (toggleButton && toggleButton.parentElement) {
            toggleButton.parentElement.removeChild(toggleButton);
        }

        document.body.classList.remove('lav-hide-native');

        if (customViewContainer && customViewContainer.parentElement) {
            customViewContainer.parentElement.removeChild(customViewContainer);
        }
    }

    function renderLoadingView(loaded, total) {
        if (!customViewContainer) return;

        scrollContainer = null;
        contentContainer = null;

        loaded = loaded || 0;
        total = total || 0;
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;

        const text = total > 0 ?
            `${loaded.toLocaleString()} / ${total.toLocaleString()} Songs` :
            `${loaded.toLocaleString()} Songs geladen...`;

        const barClass = total > 0 ? "" : " indeterminate";
        const barWidth = total > 0 ? `${percent}%` : "100%";

        customViewContainer.innerHTML = `
            <div class="lav-loading-view">
                <h2>Lade Lieblingssongs...</h2>
                <p>${text}</p>
                <div class="lav-progress-bar-container">
                    <div class="lav-progress-bar${barClass}" style="width: ${barWidth}"></div>
                </div>
            </div>
        `;
    }

    function renderEmptyState() {
        if (!customViewContainer) return;
        scrollContainer = null;
        contentContainer = null;
        customViewContainer.innerHTML = `
            <div class="lav-loading-view">
                <h2>Noch keine Lieblingssongs</h2>
                <p>Füge Songs zu deinen Lieblingssongs hinzu und sie erscheinen hier nach Künstler gruppiert.</p>
            </div>
        `;
    }

    // --- DATA LAYER ---

    const TTL_MS = 30 * 60 * 1000; // 30 minutes
    let cachedArtists = []; // grouped and sorted

    const DB_NAME = "LikedArtistsViewDB";
    const DB_VERSION = 4;
    let db = null;

    async function initDB() {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => reject("IndexedDB error: " + event.target.error);
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const _db = event.target.result;
                if (_db.objectStoreNames.contains("tracks")) {
                    _db.deleteObjectStore("tracks");
                }
                _db.createObjectStore("tracks", { keyPath: "uri" });
            };
        });
    }

    async function getMeta(key) {
        try {
            const val = localStorage.getItem('lav:meta:' + key);
            return val ? JSON.parse(val) : null;
        } catch(e) {
            return null;
        }
    }

    async function setMeta(key, value) {
        try {
            localStorage.setItem('lav:meta:' + key, JSON.stringify(value));
        } catch(e) {
            console.error("LikedArtistsView: Failed to save meta", e);
        }
        return Promise.resolve();
    }

    async function getAllTracksFromDB() {
        return new Promise((resolve, reject) => {
            if (!db) return resolve([]);
            const transaction = db.transaction(["tracks"], "readonly");
            const store = transaction.objectStore("tracks");
            const request = store.getAll();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result || []);
        });
    }

    async function clearDatabaseAndCache() {
        try {
            localStorage.removeItem('lav:meta:lastSync');
            localStorage.removeItem('lav:meta:totalTracks');
            localStorage.removeItem('lav:meta:lastApiTotal');
            localStorage.removeItem('lav:artistImages');
            cachedArtists = [];
            if (!db) {
                try {
                    await initDB();
                } catch (e) {
                    if (window.indexedDB?.deleteDatabase) {
                        window.indexedDB.deleteDatabase(DB_NAME);
                    }
                }
            }
            if (db) {
                const transaction = db.transaction(["tracks"], "readwrite");
                const store = transaction.objectStore("tracks");
                await new Promise((resolve) => {
                    const req = store.clear();
                    req.onsuccess = resolve;
                    req.onerror = resolve;
                });
            }
        } catch(e) {
            console.error("LikedArtistsView: Failed to clear DB and cache", e);
        }
    }

    async function saveBatchToDB(tracks) {
        return new Promise((resolve, reject) => {
            if (!db) return resolve();
            const transaction = db.transaction(["tracks"], "readwrite");
            const store = transaction.objectStore("tracks");

            // Clear all previous tracks so unliked songs are removed from IndexedDB
            const clearReq = store.clear();
            clearReq.onerror = () => reject(clearReq.error);
            clearReq.onsuccess = () => {
                tracks.forEach(t => {
                    if (!t.track || !t.track.uri) return; // Guard clause added
                    try {
                        store.put({
                            uri: t.track.uri,
                            name: t.track.name,
                            artistName: t.track.artists[0]?.name || "Unknown",
                            artistUri: t.track.artists[0]?.uri || "",
                            albumName: t.track.album?.name || "",
                            albumUri: t.track.album?.uri || "",
                            albumImage: t.track.album?.images?.[0]?.url || t.track.album?.images?.[1]?.url || "",
                            albumReleaseDate: t.track.album?.release_date || t.track.album?.releaseDate || "",
                            trackNumber: t.track.track_number || t.track.trackNumber || 0,
                            discNumber: t.track.disc_number || t.track.discNumber || 1,
                            durationMs: t.track.duration_ms,
                            addedAt: t.added_at
                        });
                    } catch(e) {}
                });
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                window.Spicetify.showNotification("DB-Speicherfehler: " + transaction.error, true);
                reject(transaction.error);
            };
        });
    }

    function groupAndSortTracks(tracks) {
        const artistMap = new Map();

        tracks.forEach(t => {
            const artistUri = t.artistUri;
            if (!artistUri) return;

            if (!artistMap.has(artistUri)) {
                artistMap.set(artistUri, {
                    name: t.artistName,
                    uri: artistUri,
                    fallbackImage: t.albumImage,
                    albumCounts: new Map(),
                    songs: [],
                    genres: [],
                    addedAt: t.addedAt
                });
            }

            const artistData = artistMap.get(artistUri);
            artistData.songs.push(t);

            if (t.albumImage) {
                const count = artistData.albumCounts.get(t.albumImage) || 0;
                artistData.albumCounts.set(t.albumImage, count + 1);
            }
        });

        const artistsArray = Array.from(artistMap.values());

        // Sort artists: Song count DESC, then Name ASC
        artistsArray.sort((a, b) => {
            if (b.songs.length !== a.songs.length) {
                return b.songs.length - a.songs.length; // Descending by count
            }
            return a.name.localeCompare(b.name); // Ascending by name
        });

        // Process artists: cleanup temp data and sort songs
        artistsArray.forEach(artist => {
            let maxCount = 0;
            let bestImage = artist.fallbackImage;

            for (const [image, count] of artist.albumCounts.entries()) {
                if (count > maxCount) {
                    maxCount = count;
                    bestImage = image;
                }
            }
            artist.fallbackImage = bestImage;
            delete artist.albumCounts; // Clean up temp data

            artist.songs.sort((a, b) => {
                // 1. Album Release Date (Descending)
                const dateA = a.albumReleaseDate || "";
                const dateB = b.albumReleaseDate || "";
                if (dateA !== dateB) {
                    return dateB.localeCompare(dateA); // Descending (newest first)
                }
                // 2. Album Name (Ascending)
                if (a.albumName !== b.albumName) {
                    return a.albumName.localeCompare(b.albumName);
                }
                // 3. Disc Number (Ascending)
                if (a.discNumber !== b.discNumber) {
                    return a.discNumber - b.discNumber;
                }
                // 4. Track Number (Ascending)
                return a.trackNumber - b.trackNumber;
            });
        });

        return artistsArray;
    }

    function renderErrorView(msg) {
        if (!customViewContainer) return;
        scrollContainer = null;
        contentContainer = null;
        customViewContainer.innerHTML = `
            <div class="lav-loading-view" style="color: #ff5555;">
                <h2>Fehler beim Laden</h2>
                <p style="word-break: break-all; max-width: 600px;">${escapeHtml(msg)}</p>
                <button onclick="location.reload()" style="margin-top:16px; padding:8px 16px; background:#1db954; color:#fff; border:none; border-radius:4px; cursor:pointer;">Spotify Neu Laden</button>
            </div>
        `;
    }

    function fetchWithTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout nach ${ms/1000}s`)), ms))
        ]);
    }

    async function fetchAllTracksFromAPI(isBackground = false) {
        if (!isBackground) renderLoadingView(0, 0);

        try {
            let allItems = [];
            let limit = 100;
            let offset = 0;
            let isFetching = true;
            let endpointToUse = null;

            // Determine which endpoint works by testing the first batch
            const endpointsToTest = [
                (l, o) => window.Spicetify.CosmosAsync.get(`sp://core-library/v1/tracks?limit=${l}&offset=${o}`),
                (l, o) => window.Spicetify.Platform?.LibraryAPI?.getTracks ? window.Spicetify.Platform.LibraryAPI.getTracks({ limit: l, offset: o }) : Promise.reject("No LibraryAPI"),
                (l, o) => window.Spicetify.CosmosAsync.get(`wg://collection/v1/v2/collection?limit=${l}&offset=${o}`),
                (l, o) => window.Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/me/tracks?limit=${Math.min(l, 50)}&offset=${o}`)
            ];

            let lastError = null;
            let testRes = null;

            for (let i = 0; i < endpointsToTest.length; i++) {
                try {
                    const testLimit = (i === 3) ? 50 : limit;
                    testRes = await fetchWithTimeout(endpointsToTest[i](testLimit, offset), 5000);
                    const items = testRes?.items || testRes || [];
                    if (Array.isArray(items)) {
                        endpointToUse = endpointsToTest[i];
                        if (i === 3) limit = 50;
                        if (items.length > 0) {
                            allItems = allItems.concat(items);
                            offset += limit;
                            if (items.length < limit) isFetching = false;
                        } else {
                            isFetching = false;
                        }
                        break;
                    }
                } catch (e) {
                    console.warn(`LikedArtistsView: Endpoint ${i} failed:`, e);
                    lastError = e;
                }
            }

            if (!endpointToUse) {
                throw new Error("Alle API-Endpunkte sind fehlgeschlagen. Letzter Fehler: " + (lastError?.message || lastError));
            }

            // Now fetch remaining batches
            while (isFetching) {
                let res = await fetchWithTimeout(endpointToUse(limit, offset), 8000);
                let items = res?.items || res || [];

                if (Array.isArray(items) && items.length > 0) {
                    allItems = allItems.concat(items);
                    offset += limit;
                    if (isActive && !isBackground) renderLoadingView(allItems.length, 0);
                    if (items.length < limit) isFetching = false;
                } else {
                    isFetching = false;
                }

                // Safety break to prevent infinite loops
                if (offset > 20000) isFetching = false;
            }

            // A legitimately empty library is not an error – show the friendly
            // empty state instead of the failure view.
            if (allItems.length === 0 && !isBackground) {
                await setMeta("lastSync", Date.now());
                await setMeta("totalTracks", 0);
                await setMeta("lastApiTotal", 0);
                renderEmptyState();
                return;
            }
            if (allItems.length === 0) {
                await setMeta("lastSync", Date.now());
                await setMeta("totalTracks", 0);
                await setMeta("lastApiTotal", 0);
                return;
            }

            // Normalize items since different APIs return slightly different shapes
            const normalizedTracks = allItems.map(t => {
                const trackInfo = t.track || t.item || t;
                const albumInfo = trackInfo.album || {};
                return {
                    track: {
                        uri: trackInfo.uri,
                        name: trackInfo.name,
                        artists: trackInfo.artists || trackInfo.authors || [{name: "Unknown", uri: ""}],
                        album: {
                            name: albumInfo.name || "Unknown",
                            uri: albumInfo.uri || "",
                            images: albumInfo.images || [],
                            release_date: albumInfo.release_date || albumInfo.releaseDate || ""
                        },
                        duration_ms: trackInfo.duration?.milliseconds || trackInfo.duration_ms || 0,
                        track_number: trackInfo.track_number || trackInfo.trackNumber || 0,
                        disc_number: trackInfo.disc_number || trackInfo.discNumber || 1
                    },
                    added_at: t.addedAt || t.added_at || new Date().toISOString()
                };
            });

            await saveBatchToDB(normalizedTracks);

            await setMeta("lastSync", Date.now());
            await setMeta("totalTracks", normalizedTracks.length);

            try {
                const apiRes = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/me/tracks?limit=1&offset=0`);
                if (typeof apiRes?.total === 'number') {
                    await setMeta("lastApiTotal", apiRes.total);
                }
            } catch (e) {}

        } catch (err) {
            console.error("LikedArtistsView: Fatal error in fetchAllTracksFromAPI", err);
            if (!isBackground) renderErrorView(err.message || err);
            throw err; // Stop loadData
        }
    }

    async function loadData() {
        if (!db) await initDB();

        const lastSync = await getMeta("lastSync");
        const totalTracksMeta = await getMeta("totalTracks") || 0;

        if (totalTracksMeta === 0 && lastSync) {
            renderEmptyState();
            return;
        }

        // Cache is valid if synced within TTL and we have tracks
        const isCacheValid = lastSync && (Date.now() - lastSync < TTL_MS);

        if (cachedArtists && cachedArtists.length > 0) {
            updateUI();
            if (!isCacheValid) {
                checkBackgroundRefresh();
            }
            return;
        }

        const tracks = await getAllTracksFromDB();

        if (isCacheValid && tracks.length > 0) {
            console.log("LikedArtistsView: Using valid cache.");
            cachedArtists = groupAndSortTracks(tracks);
            updateUI();

            // Start background refresh to check for new songs
            checkBackgroundRefresh();
        } else if (tracks.length > 0) {
            console.log("LikedArtistsView: Using expired cache, refreshing in background.");
            cachedArtists = groupAndSortTracks(tracks);
            updateUI();

            // isBackground = true
            fetchAllTracksFromAPI(true).then(async () => {
                const freshTracks = await getAllTracksFromDB();
                cachedArtists = groupAndSortTracks(freshTracks);
                if (isActive) {
                    if (cachedArtists.length === 0) renderEmptyState();
                    else updateUI();
                }
            }).catch(e => console.error("Background refresh failed", e));
        } else {
            console.log("LikedArtistsView: No cache, fetching all...");
            // isBackground = false
            await fetchAllTracksFromAPI(false);
            const freshTracks = await getAllTracksFromDB();
            cachedArtists = groupAndSortTracks(freshTracks);
            if (isActive) {
                if (cachedArtists.length === 0) renderEmptyState();
                else updateUI();
            }
        }
    }

    async function checkBackgroundRefresh() {
        try {
            const lastApiTotal = await getMeta("lastApiTotal");
            const res = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/me/tracks?limit=1&offset=0`);

            if (typeof res?.total === 'number' && lastApiTotal !== null && res.total !== lastApiTotal) {
                console.log(`LikedArtistsView: Total changed (${lastApiTotal} -> ${res.total}), refreshing in background...`);
                await setMeta("lastApiTotal", res.total);
                await fetchAllTracksFromAPI(true);
                const tracks = await getAllTracksFromDB();
                cachedArtists = groupAndSortTracks(tracks);
                if (isActive) updateUI();
            } else {
                if (typeof res?.total === 'number') {
                    await setMeta("lastApiTotal", res.total);
                }
                console.log("LikedArtistsView: Total unchanged, skip refresh.");
                // Update timestamp so we don't check again for 30min
                await setMeta("lastSync", Date.now());
            }
        } catch (e) {
            console.error("LikedArtistsView: Background check failed", e);
        }
    }

    // --- END DATA LAYER ---

    // --- FILTER AND SEARCH LAYER ---

    let isSearchActive = false;
    let domObserver = null;
    let searchDebounceTimeout = null;

    function onSearchInput(e) {
        if (e.target && (e.target.matches('input[role="searchbox"]') || e.target.classList.contains('x-filterBox-searchInput') || e.target.classList.contains('x-filterBox-filterInput'))) {
            if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
            searchDebounceTimeout = setTimeout(updateSearchAndFilterState, 100);
        }
    }

    function initDOMObserver() {
        if (domObserver) return;

        domObserver = new MutationObserver(() => {
            if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
            searchDebounceTimeout = setTimeout(updateSearchAndFilterState, 150);
            createOrUpdateToggleButton();
        });

        const header = document.querySelector('.main-view-container__scroll-node-child') || document.body;
        domObserver.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-checked'] });

        const mainView = document.querySelector('.main-view-container');
        if (mainView) {
            mainView.addEventListener('input', onSearchInput);
        }

        createOrUpdateToggleButton();
    }

    function updateSearchAndFilterState() {
        let filterActive = false;

        const mainView = document.querySelector('.main-view-container');
        if (!mainView) return;

        // 1. Search Input
        const searchInput = mainView.querySelector('input[role="searchbox"]') || mainView.querySelector('input.x-filterBox-searchInput') || mainView.querySelector('.x-filterBox-filterInput');
        if (searchInput && searchInput.value.trim() !== '') {
            filterActive = true;
        }

        // 2. Active Chip (Check if any aria-checked button has text, avoiding icon-only buttons like Download)
        const checkedElements = mainView.querySelectorAll('button[aria-checked="true"]');
        checkedElements.forEach(btn => {
            if (btn.offsetWidth > 0 && btn.offsetHeight > 0 && btn.textContent.trim() !== '') {
                filterActive = true;
            }
        });

        if (filterActive !== isSearchActive) {
            isSearchActive = filterActive;

            if (isSearchActive) {
                document.body.classList.remove('lav-hide-native');
                if (customViewContainer) customViewContainer.style.display = 'none';
            } else {
                if (isViewActive) {
                    document.body.classList.add('lav-hide-native');
                    if (customViewContainer) {
                        customViewContainer.style.display = ''; // back to CSS default (#lav-container is flex)
                        renderVirtualList(); // Force re-render to recalculate heights after being hidden
                    }
                }
            }
        }
    }

    // --- END FILTER AND SEARCH LAYER ---

    // --- UI RENDERER ---

    const SONGS_PADDING = 24;

    function formatDuration(ms) {
        if (!ms || isNaN(ms)) return "0:00";
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function toggleArtist(uri) {
        if (expandedArtists.has(uri)) {
            expandedArtists.delete(uri);
        } else {
            expandedArtists.add(uri);
        }
        renderVirtualList(); // Re-render to adjust heights
    }

    async function clearQueue() {
        if (Spicetify.Platform?.PlayerAPI?.clearQueue) {
            try {
                await Spicetify.Platform.PlayerAPI.clearQueue();
            } catch (err) {
                console.warn("LikedArtistsView: clearQueue failed", err);
            }
        }
    }

    async function queueTracks(trackUris) {
        if (!trackUris || trackUris.length === 0) return;
        const items = trackUris.map(uri => ({ uri }));

        if (typeof Spicetify.addToQueue === 'function') {
            try {
                for (let i = 0; i < items.length; i += 40) {
                    const chunk = items.slice(i, i + 40);
                    await Spicetify.addToQueue(chunk);
                    if (items.length > 40) {
                        await new Promise(r => setTimeout(r, 30));
                    }
                }
                return;
            } catch (e) {
                console.warn("LikedArtistsView: Spicetify.addToQueue failed, falling back to PlayerAPI", e);
            }
        }

        if (Spicetify.Platform?.PlayerAPI?.addToQueue) {
            try {
                for (let i = 0; i < items.length; i += 40) {
                    const chunk = items.slice(i, i + 40);
                    await Spicetify.Platform.PlayerAPI.addToQueue(chunk);
                    if (items.length > 40) {
                        await new Promise(r => setTimeout(r, 30));
                    }
                }
            } catch (e2) {
                console.error("LikedArtistsView: PlayerAPI.addToQueue failed", e2);
            }
        }
    }

    async function startPlayback(uri) {
        if (Spicetify.Platform?.PlayerAPI?.play) {
            try {
                await Spicetify.Platform.PlayerAPI.play(
                    { uri },
                    {},
                    {}
                );
                return;
            } catch (e) {
                console.warn("LikedArtistsView: PlayerAPI.play failed, falling back to Player.playUri", e);
            }
        }
        if (Spicetify.Player?.playUri) {
            await Spicetify.Player.playUri(uri);
        } else if (Spicetify.Player?.play) {
            await Spicetify.Player.play(uri);
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

    async function enableShuffle() {
        if (Spicetify.Platform?.PlayerAPI?.setShuffle) {
            try {
                await Spicetify.Platform.PlayerAPI.setShuffle(true);
            } catch (err) {
                console.warn("LikedArtistsView: PlayerAPI.setShuffle failed", err);
            }
        } else if (Spicetify.Player?.setShuffle) {
            try {
                Spicetify.Player.setShuffle(true);
            } catch (err) {}
        }
    }

    async function playArtistSongs(artistUri) {
        const artist = cachedArtists.find(a => a.uri === artistUri);
        if (!artist || !artist.songs || !artist.songs.length) return;

        const uris = artist.songs.map(s => s.track?.uri || s.uri).filter(u => u && !u.startsWith('spotify:local:'));
        if (uris.length === 0) {
            window.Spicetify.showNotification("Keine abspielbaren Songs gefunden", true);
            return;
        }

        try {
            // Enable Spotify shuffle mode on player
            await enableShuffle();

            // Shuffle artist tracks
            const shuffled = shuffleArray(uris);

            // 1. Play first shuffled track standalone
            await startPlayback(shuffled[0]);

            // 2. Clear old queue and add remaining shuffled tracks
            await new Promise(r => setTimeout(r, 100));
            await clearQueue();

            if (shuffled.length > 1) {
                await queueTracks(shuffled.slice(1, 150));
            }

            window.Spicetify.showNotification(`Spielt: ${artist.name} (Shuffle)`, false);
        } catch (err) {
            console.error("LikedArtistsView: Artist playback failed", err);
            try {
                if (Spicetify.Player?.playUri) {
                    await Spicetify.Player.playUri(uris[0]);
                    window.Spicetify.showNotification(`Spielt: ${artist.name}`, false);
                } else {
                    window.Spicetify.showNotification("Wiedergabe fehlgeschlagen", true);
                }
            } catch (err2) {
                window.Spicetify.showNotification("Wiedergabe fehlgeschlagen", true);
            }
        }
    }

    function buildArtistRow(artist, topOffset) {
        const isExpanded = expandedArtists.has(artist.uri);
        const height = ROW_HEIGHT + (isExpanded ? (artist.songs.length * SONG_ROW_HEIGHT + SONGS_PADDING) : 0);
        const imgUrl = artist.fallbackImage || PLACEHOLDER_IMAGE;
        const currentUri = Spicetify.Player.data?.item?.uri;
        const isCurrentlyPlaying = !!(Spicetify.Player.isPlaying && Spicetify.Player.isPlaying());

        const el = document.createElement('div');
        el.className = 'lav-artist-container';
        el.style.position = 'absolute';
        el.style.top = `${topOffset}px`;
        el.style.width = '100%';
        el.style.height = `${height}px`;

        let html = `
            <div class="lav-artist-row" data-artist-uri="${escapeHtml(artist.uri)}" data-expanded="${isExpanded}">
                <div class="lav-image-container">
                    <img class="lav-artist-image lav-image-loaded" src="${escapeHtml(imgUrl)}" loading="lazy" alt="">
                    <div class="lav-play-button" data-artist-uri="${escapeHtml(artist.uri)}" title="${escapeHtml(artist.name)} abspielen">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
                <div class="lav-artist-info">
                    <div class="lav-artist-name">${escapeHtml(artist.name)}</div>
                    <div class="lav-artist-meta">${artist.songs.length} Song${artist.songs.length > 1 ? 's' : ''}</div>
                </div>
                <svg class="lav-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4.93 1.93a1 1 0 0 1 1.41 0l5.66 5.66a1 1 0 0 1 0 1.41l-5.66 5.66a1 1 0 0 1-1.41-1.41L9.88 8 4.93 3.05a1 1 0 0 1 0-1.41z"/>
                </svg>
            </div>
        `;

        if (isExpanded) {
            let songsHtml = '<div class="lav-songs-list">';
            artist.songs.forEach((song, i) => {
                const isSongActive = currentUri === song.uri;
                const isSongPlaying = isSongActive && isCurrentlyPlaying;
                const eqBars = isSongPlaying ? '<div class="lav-eq"><span></span><span></span><span></span></div>' : '';
                songsHtml += `
                    <div class="lav-song-row ${isSongActive ? 'lav-song-row--playing' : ''}" data-song-uri="${escapeHtml(song.uri)}" data-index="${i}" style="--row-i: ${i}">
                        <div class="lav-song-num">${i + 1}</div>
                        <img class="lav-song-cover" src="${escapeHtml(song.albumImage || PLACEHOLDER_IMAGE)}" loading="lazy" alt="">
                        <div class="lav-song-details">
                            <div class="lav-song-title">
                                <span class="lav-song-title-text">${escapeHtml(song.name)}</span>
                                ${eqBars}
                            </div>
                            <div class="lav-song-album">${escapeHtml(song.albumName)}</div>
                        </div>
                        <div class="lav-song-duration">${formatDuration(song.durationMs)}</div>
                    </div>
                `;
            });
            songsHtml += '</div>';
            html += songsHtml;
        }

        el.innerHTML = html;

        // Events
        const rowHeader = el.querySelector('.lav-artist-row');
        rowHeader.addEventListener('click', () => toggleArtist(artist.uri));

        const playBtn = el.querySelector('.lav-play-button');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playArtistSongs(artist.uri);
            });
        }

        if (isExpanded) {
            const songRows = el.querySelectorAll('.lav-song-row');
            songRows.forEach(row => {
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const uri = row.dataset.songUri;
                    playTrack(uri, artist.uri);
                });
            });
        }

        return el;
    }

    function renderVirtualList() {
        if (!scrollContainer || !contentContainer) return;
        if (isSearchActive) return; // Don't render if native search is active

        const scrollTop = scrollContainer.scrollTop;
        const viewportHeight = scrollContainer.clientHeight;

        let currentTop = 0;
        let startIndex = -1;
        let endIndex = -1;
        let offsets = [];

        // Calculate positions
        for (let i = 0; i < renderData.length; i++) {
            offsets.push(currentTop);
            const artist = renderData[i];
            const height = ROW_HEIGHT + (expandedArtists.has(artist.uri) ? (artist.songs.length * SONG_ROW_HEIGHT + SONGS_PADDING) : 0);

            if (startIndex === -1 && currentTop + height > scrollTop - (BUFFER_ROWS * ROW_HEIGHT)) {
                startIndex = i;
            }
            if (currentTop < scrollTop + viewportHeight + (BUFFER_ROWS * ROW_HEIGHT)) {
                endIndex = i;
            }

            currentTop += height;
        }

        if (startIndex === -1) startIndex = 0;
        if (endIndex === -1) endIndex = 0;

        contentContainer.style.height = `${currentTop}px`;
        contentContainer.innerHTML = ''; // Clear current

        // Render visible items
        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i <= endIndex; i++) {
            if (renderData[i]) {
                const el = buildArtistRow(renderData[i], offsets[i]);
                fragment.appendChild(el);
            }
        }
        contentContainer.appendChild(fragment);
    }

    async function playTrack(uri, artistUri) {
        if (!uri) return;
        try {
            let remaining = [];
            if (artistUri) {
                const artist = cachedArtists.find(a => a.uri === artistUri);
                if (artist && artist.songs) {
                    const uris = artist.songs
                        .map(s => s.track?.uri || s.uri)
                        .filter(u => u && !u.startsWith('spotify:local:'));
                    const isShuffle = !!(Spicetify.Player?.getShuffle && Spicetify.Player.getShuffle());
                    if (isShuffle) {
                        const otherTracks = uris.filter(u => u !== uri);
                        remaining = shuffleArray(otherTracks).slice(0, 150);
                    } else {
                        const idx = uris.indexOf(uri);
                        if (idx !== -1 && idx < uris.length - 1) {
                            remaining = uris.slice(idx + 1, idx + 150);
                        }
                    }
                }
            }

            await startPlayback(uri);

            await new Promise(r => setTimeout(r, 100));
            await clearQueue();

            if (remaining.length > 0) {
                await queueTracks(remaining);
            }
        } catch (err) {
            console.warn("LikedArtistsView: Play error", err);
            try {
                if (Spicetify.Player?.playUri) await Spicetify.Player.playUri(uri);
                else if (Spicetify.Player?.play) await Spicetify.Player.play(uri);
            } catch (e2) {
                console.error("LikedArtistsView: Playback failed", e2);
            }
        }
    }

    function onSongChange() {
        if (!isActive) return;
        const currentUri = Spicetify.Player.data?.item?.uri;
        const isCurrentlyPlaying = !!(Spicetify.Player.isPlaying && Spicetify.Player.isPlaying());

        // Remove previous highlights and equalizers
        document.querySelectorAll('.lav-song-row--playing').forEach(el => el.classList.remove('lav-song-row--playing'));
        document.querySelectorAll('.lav-eq').forEach(el => el.remove());

        if (currentUri) {
            // Add new highlight
            const safeUri = window.CSS?.escape ? window.CSS.escape(currentUri) : currentUri.replace(/["\\]/g, '\\$&');
            const activeRows = document.querySelectorAll(`.lav-song-row[data-song-uri="${safeUri}"]`);
            activeRows.forEach(el => {
                el.classList.add('lav-song-row--playing');
                if (isCurrentlyPlaying && !el.querySelector('.lav-eq')) {
                    const title = el.querySelector('.lav-song-title');
                    if (title) {
                        title.insertAdjacentHTML('beforeend', '<div class="lav-eq"><span></span><span></span><span></span></div>');
                    }
                }
            });
        }
    }

    Spicetify.Player.addEventListener("songchange", onSongChange);
    Spicetify.Player.addEventListener("onplaypause", onSongChange);

    function updateUI() {
        if (!customViewContainer) return;

        renderData = cachedArtists; // No custom filtering needed anymore, fallback to native if searching

        if (!scrollContainer || !customViewContainer.contains(scrollContainer)) {
            customViewContainer.innerHTML = `
                <div class="lav-scroll-container">
                    <div class="lav-content-container" style="position: relative; width: 100%;"></div>
                </div>
            `;
            scrollContainer = customViewContainer.querySelector('.lav-scroll-container');
            contentContainer = customViewContainer.querySelector('.lav-content-container');

            scrollContainer.addEventListener('scroll', () => {
                if (uiAnimationFrame) cancelAnimationFrame(uiAnimationFrame);
                uiAnimationFrame = requestAnimationFrame(renderVirtualList);
            });
        }

        renderVirtualList();
    }

    // --- END UI RENDERER ---

    // Navigation Listener
    Spicetify.Platform.History.listen((location) => {
        if (location.pathname === "/collection/tracks") {
            if (isViewActive) {
                document.body.classList.add('lav-hide-native');
            }
            activate();
        } else {
            deactivate();
        }
    });

    // Initial check
    if (Spicetify.Platform.History.location.pathname === "/collection/tracks") {
        if (isViewActive) {
            document.body.classList.add('lav-hide-native');
        }
        activate();
    }

})();
