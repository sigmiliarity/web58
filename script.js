// DOM Selectors Helper
const $ = id => document.getElementById(id);
const audio = $("audio");
const preloadAudio = $("preload-audio");

// Global Application State Struct
const State = {
    library: [],
    playlists: JSON.parse(localStorage.getItem("sigma_playlists") || "[]"),
    queue: [],
    index: 0,
    historyStack: [],
    historyIndex: -1,
    audioCtx: null,
    analyser: null,
    vTime: 0,
    fuse: null,
    isLooping: false,
    isShuffling: false,
    contextMenuTarget: null
};

// Ensure playlists have hidden UUIDs
State.playlists.forEach(pl => {
    if (!pl.id) pl.id = 'pl_' + Math.random().toString(36).substring(2, 9);
});
localStorage.setItem("sigma_playlists", JSON.stringify(State.playlists));

// Humanize parsing audio runtimes with error fallback
const formatTime = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0 || isNaN(seconds)) {
        console.error("Invalid or undefined audio duration/time:", seconds);
        return "??:??";
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
};

const getFlattenedAlbums = () => State.library.flatMap(art => art.albums.map(alb => ({ ...alb, artist: art.name })));
const getFlattenedTracks = () => State.library.flatMap(art => art.albums.flatMap(alb => alb.tracks));
const findTargetAlbum = (artistName, albumTitle) => State.library.find(a => a.name === artistName)?.albums.find(al => al.title === albumTitle);

// Toast Notification System
function showToast(message, type = "success") {
    const container = $("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `pointer-events-auto px-5 py-3.5 rounded-2xl text-sm font-semibold shadow-2xl backdrop-blur-xl border transition-all duration-300 transform translate-y-4 opacity-0 flex items-center gap-3 ${
        type === "error" ? "bg-rose-500/20 border-rose-500/40 text-rose-200" : "bg-[#161622]/95 border-white/15 text-white"
    }`;
    toast.innerHTML = `<span>${type === "error" ? "⚠️" : "✨"}</span><span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove("translate-y-4", "opacity-0");
    });

    setTimeout(() => {
        toast.classList.add("translate-y-4", "opacity-0");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// URL Hash Router & Navigation Engine
function getRouteFromHash() {
    const hash = window.location.hash || "#/";
    if (hash === "#/" || hash === "#") return { view: "library" };
    if (hash.startsWith("#/search")) {
        const query = decodeURIComponent(hash.split("?q=")[1] || "");
        return { view: "search", query };
    }
    if (hash.startsWith("#/al/")) {
        const parts = hash.replace("#/al/", "").split("/");
        const artistName = decodeURIComponent(parts[0] || "");
        const albumTitle = decodeURIComponent(parts[1] || "");
        return { view: "album", artistName, albumTitle };
    }
    if (hash.startsWith("#/ar/")) {
        const artistName = decodeURIComponent(hash.replace("#/ar/", ""));
        return { view: "artist", artistName };
    }
    if (hash.startsWith("#/pl/")) {
        const playlistId = hash.replace("#/pl/", "");
        return { view: "playlist", playlistId };
    }
    return { view: "library" };
}

function navigateTo(hash, pushHistory = true) {
    if (pushHistory) {
        window.location.hash = hash;
    } else {
        renderCurrentRoute();
    }
}

window.addEventListener("hashchange", () => renderCurrentRoute());

function renderCurrentRoute() {
    const route = getRouteFromHash();
    const container = document.querySelector("main");
    if (!container) return;
    container.innerHTML = "";

    updateNavigationButtons();

    if (route.view === "library") {
        renderLibraryView(container);
    } else if (route.view === "search") {
        renderSearchView(container, route.query);
    } else if (route.view === "album") {
        renderAlbumView(container, route.artistName, route.albumTitle);
    } else if (route.view === "artist") {
        renderArtistView(container, route.artistName);
    } else if (route.view === "playlist") {
        renderPlaylistView(container, route.playlistId);
    }
}

function updateNavigationButtons() {
    const backBtn = $("go-back");
    const forwardBtn = $("go-forward");
    if (backBtn) backBtn.onclick = () => window.history.back();
    if (forwardBtn) forwardBtn.onclick = () => window.history.forward();
}

const logoHome = $("logo-home");
if (logoHome) logoHome.onclick = () => navigateTo("#/");

// Search Input Handler
let searchTimeout;
const searchInput = $("search");
if (searchInput) {
    searchInput.oninput = (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        searchTimeout = setTimeout(() => {
            if (query) {
                navigateTo(`#/search?q=${encodeURIComponent(query)}`);
            } else {
                navigateTo("#/");
            }
        }, 200);
    };
}

// Render Views with Refined Proportions and CSS Variable Accent Integration
function renderLibraryView(container) {
    container.innerHTML = `
        <div class="space-y-12 w-full max-w-7xl mx-auto px-4 sm:px-6">
            <!-- Playlists Section -->
            <section class="space-y-5">
                <div class="flex items-center justify-between">
                    <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">Playlists</h2>
                    <button id="create-playlist-btn" style="background-color: var(--accent); color: var(--bg);" class="font-bold px-4 py-2.5 rounded-xl text-xs transition-all shadow-lg hover:opacity-90">+ New Playlist</button>
                </div>
                <div id="playlists-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5 w-full"></div>
            </section>

            <!-- Artists Section -->
            <section class="space-y-5">
                <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">Artists</h2>
                <div id="artists-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5 w-full"></div>
            </section>

            <!-- Albums Section -->
            <section class="space-y-5">
                <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">Albums</h2>
                <div id="albums-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5 w-full"></div>
            </section>
        </div>
    `;

    const playlistsGrid = container.querySelector("#playlists-grid");
    const artistsGrid = container.querySelector("#artists-grid");
    const albumsGrid = container.querySelector("#albums-grid");

    if (State.playlists.length === 0) {
        playlistsGrid.innerHTML = `<p class="text-slate-400 text-sm col-span-full py-10 text-center bg-white/[0.02] rounded-3xl border border-white/5">No custom playlists yet. Create one above.</p>`;
    } else {
        playlistsGrid.innerHTML = State.playlists.map(pl => `
            <div class="card group relative bg-[#121218] hover:bg-[#1a1a24] border border-white/10 rounded-2xl p-3.5 cursor-pointer transition-all duration-300 shadow-xl flex flex-col justify-between" style="--card-hover-border: var(--accent);" data-type="playlist" data-id="${pl.id}">
                <div>
                    <div class="card-img relative aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-[var(--accent)]/20 to-purple-500/20 mb-3 shadow-inner flex items-center justify-center">
                        <span class="text-3xl group-hover:scale-110 transition-transform duration-300">🎵</span>
                        <button class="play-card-btn absolute inset-0 bg-black/50 font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-xl" style="color: var(--accent);">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                        </button>
                    </div>
                    <div class="playlist-title-wrapper">
                        <h3 class="card-title font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors" title="Click to rename">${pl.name}</h3>
                    </div>
                </div>
                <p class="card-sub text-[11px] text-slate-400 mt-1">${pl.tracks.length} tracks</p>
            </div>
        `).join("");
    }

    artistsGrid.innerHTML = State.library.map(art => `
        <div class="card artist-type group relative bg-[#121218] hover:bg-[#1a1a24] border border-white/10 rounded-2xl p-3.5 cursor-pointer transition-all duration-300 shadow-xl text-center flex flex-col items-center" data-type="artist" data-artist="${encodeURIComponent(art.name)}">
            <div class="card-img relative w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden bg-slate-800 mb-3 shadow-md border border-white/10">
                <img src="${encodeURI(art.img)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" alt="${art.name}">
            </div>
            <h3 class="card-title font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors w-full px-1">${art.name}</h3>
            <span class="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider font-mono">Artist</span>
        </div>
    `).join("");

    albumsGrid.innerHTML = getFlattenedAlbums().map(alb => `
        <div class="card group relative bg-[#121218] hover:bg-[#1a1a24] border border-white/10 rounded-2xl p-3.5 cursor-pointer transition-all duration-300 shadow-xl flex flex-col justify-between" data-type="album" data-artist="${encodeURIComponent(alb.artist)}" data-album="${encodeURIComponent(alb.title)}">
            <div>
                <div class="card-img relative aspect-square rounded-xl overflow-hidden bg-slate-800 mb-3 shadow-md">
                    <img src="${encodeURI(alb.cover)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" alt="${alb.title}">
                    <button class="play-card-btn absolute bottom-2.5 right-2.5 w-9 h-9 rounded-xl font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-110" style="background-color: var(--accent); color: var(--bg);">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                    </button>
                </div>
                <h3 class="card-title font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors${alb.explicit ? ' text-rose-400' : ''}">${alb.title}</h3>
            </div>
            <p class="card-sub text-[11px] text-slate-400 truncate mt-1">${alb.artist}</p>
        </div>
    `).join("");

    const createPlaylistBtn = container.querySelector("#create-playlist-btn");
    if (createPlaylistBtn) {
        createPlaylistBtn.onclick = () => {
            const newId = 'pl_' + Math.random().toString(36).substring(2, 9);
            State.playlists.push({ id: newId, name: `New Playlist #${State.playlists.length + 1}`, tracks: [] });
            localStorage.setItem("sigma_playlists", JSON.stringify(State.playlists));
            renderLibraryView(container);
            showToast("Playlist created successfully");
        };
    }

    container.querySelectorAll(".playlist-title-wrapper").forEach(wrapper => {
        const card = wrapper.closest(".card");
        const plId = card.dataset.id;
        const pl = State.playlists.find(p => p.id === plId);
        
        wrapper.onclick = (e) => {
            e.stopPropagation();
            const h3 = wrapper.querySelector("h3");
            const currentName = pl.name;
            const input = document.createElement("input");
            input.type = "text";
            input.value = currentName;
            input.className = "w-full bg-white/10 border rounded px-2 py-0.5 text-xs sm:text-sm text-white font-semibold outline-none";
            input.style.borderColor = "var(--accent)";
            
            wrapper.replaceChild(input, h3);
            input.focus();
            input.select();

            const saveRename = () => {
                const trimmed = input.value.trim();
                if (trimmed) {
                    pl.name = trimmed;
                    localStorage.setItem("sigma_playlists", JSON.stringify(State.playlists));
                }
                renderLibraryView(container);
            };

            input.onblur = saveRename;
            input.onkeydown = (ev) => {
                if (ev.key === "Enter") saveRename();
                if (ev.key === "Escape") renderLibraryView(container);
            };
        };
    });
}

function renderSearchView(container, query) {
    const cleanQuery = query.toLowerCase().trim();
    const allAlbums = getFlattenedAlbums();

    const filteredArtists = State.library.filter(art => art.name.toLowerCase().includes(cleanQuery));
    const filteredAlbums = allAlbums.filter(alb => alb.title.toLowerCase().includes(cleanQuery) || alb.artist.toLowerCase().includes(cleanQuery));
    const filteredTracks = State.fuse ? State.fuse.search(cleanQuery).map(r => r.item) : [];

    container.innerHTML = `
        <div class="space-y-10 w-full max-w-7xl mx-auto px-4 sm:px-6">
            <div class="border-b border-white/10 pb-4">
                <h2 class="text-2xl sm:text-3xl font-extrabold text-white">Search Results for "${query}"</h2>
            </div>

            <!-- Artists Grid -->
            <section class="space-y-4 ${filteredArtists.length === 0 ? 'hidden' : ''}">
                <h3 class="text-lg font-bold text-white">Artists</h3>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5 w-full">
                    ${filteredArtists.map(art => `
                        <div class="card artist-type group relative bg-[#121218] hover:bg-[#1a1a24] border border-white/10 rounded-2xl p-3.5 cursor-pointer transition-all duration-300 shadow-xl text-center flex flex-col items-center" data-type="artist" data-artist="${encodeURIComponent(art.name)}">
                            <div class="card-img relative w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden bg-slate-800 mb-3 shadow-md border border-white/10">
                                <img src="${encodeURI(art.img)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" alt="${art.name}">
                            </div>
                            <h3 class="card-title font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors w-full px-1">${art.name}</h3>
                        </div>
                    `).join("")}
                </div>
            </section>

            <!-- Albums Grid -->
            <section class="space-y-4 ${filteredAlbums.length === 0 ? 'hidden' : ''}">
                <h3 class="text-lg font-bold text-white">Albums</h3>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5 w-full">
                    ${filteredAlbums.map(alb => `
                        <div class="card group relative bg-[#121218] hover:bg-[#1a1a24] border border-white/10 rounded-2xl p-3.5 cursor-pointer transition-all duration-300 shadow-xl flex flex-col justify-between" data-type="album" data-artist="${encodeURIComponent(alb.artist)}" data-album="${encodeURIComponent(alb.title)}">
                            <div>
                                <div class="card-img relative aspect-square rounded-xl overflow-hidden bg-slate-800 mb-3 shadow-md">
                                    <img src="${encodeURI(alb.cover)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" alt="${alb.title}">
                                    <button class="play-card-btn absolute bottom-2.5 right-2.5 w-9 h-9 rounded-xl font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-110" style="background-color: var(--accent); color: var(--bg);">
                                        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                                    </button>
                                </div>
                                <h3 class="card-title font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors">${alb.title}</h3>
                            </div>
                            <p class="card-sub text-[11px] text-slate-400 truncate mt-1">${alb.artist}</p>
                        </div>
                    `).join("")}
                </div>
            </section>

            <!-- Tracks Grid -->
            <section class="space-y-4 ${filteredTracks.length === 0 ? 'hidden' : ''}">
                <h3 class="text-lg font-bold text-white">Tracks</h3>
                <div class="space-y-2 w-full">
                    ${filteredTracks.map((track, idx) => `
                        <div class="track-row group flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 cursor-pointer transition-all" data-file="${encodeURIComponent(track.file)}">
                            <div class="flex items-center gap-3.5 min-w-0 flex-1">
                                <img src="${encodeURI(track.albumC)}" class="w-11 h-11 rounded-xl object-cover" alt="">
                                <div class="min-w-0 flex-1">
                                    <h4 class="font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors">${track.title}</h4>
                                    <p class="text-[11px] text-slate-400 truncate">${track.artist} •${track.album}</p>
                                </div>
                            </div>
                            <span class="text-xs font-mono text-slate-400 ml-4">${track.duration ? formatTime(track.duration) : "??:??"}</span>
                        </div>
                    `).join("")}
                </div>
            </section>

            ${filteredArtists.length === 0 && filteredAlbums.length === 0 && filteredTracks.length === 0 ? `
                <div class="py-20 text-center text-slate-400 text-base">No results found matching "${query}".</div>
            ` : ''}
        </div>
    `;
}

function renderAlbumView(container, artistName, albumTitle) {
    const album = findTargetAlbum(artistName, albumTitle);
    if (!album) {
        container.innerHTML = `<div class="py-20 text-center text-rose-400">Album not found.</div>`;
        return;
    }

    const totalDurationSecs = album.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);

    container.innerHTML = `
        <div class="space-y-10 w-full max-w-7xl mx-auto px-4 sm:px-6">
            <div class="flex flex-col md:flex-row items-center md:items-end gap-8 bg-gradient-to-b from-[var(--accent)]/15 via-transparent to-transparent p-6 sm:p-10 rounded-3xl border border-white/10 backdrop-blur-2xl w-full">
                <img src="${encodeURI(album.cover)}" class="w-48 h-48 sm:w-64 sm:h-64 object-cover rounded-2xl shadow-2xl border border-white/15 flex-shrink-0" alt="${album.title}">
                <div class="space-y-3.5 text-center md:text-left flex-1">
                    <span class="text-[11px] uppercase tracking-widest font-bold" style="color: var(--accent);">Album Release</span>
                    <h2 class="text-3xl sm:text-5xl font-extrabold text-white tracking-tight${album.explicit ? ' text-rose-400' : ''}">${album.title}</h2>
                    <p class="text-base sm:text-lg text-slate-300 font-medium cursor-pointer hover:underline" id="hero-artist-link">${artistName}</p>
                    <div class="flex flex-wrap justify-center md:justify-start items-center gap-3 text-xs text-slate-400 font-mono">
                        <span>${album.date || "2026"}</span>
                        <span>•</span>
                        <span>${album.tracks.length} tracks</span>
                        <span>•</span>
                        <span>${totalDurationSecs ? `~${Math.round(totalDurationSecs / 60)} mins` : "??:??"}</span>
                    </div>
                    <p class="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">${album.description || ``}</p>
                    <div class="flex flex-wrap justify-center md:justify-start items-center gap-3 pt-2">
                        <button id="play-album-btn" style="background-color: var(--accent); color: var(--bg);" class="px-6 py-3 rounded-xl font-bold text-xs sm:text-sm shadow-xl transition-all flex items-center gap-2 hover:opacity-90">Play Album</button>
                        <button id="shuffle-album-btn" class="bg-white/10 hover:bg-white/20 text-white px-5 py-3 rounded-xl font-semibold text-xs sm:text-sm border border-white/10 transition-all">Shuffle</button>
                        <button id="add-queue-album-btn" class="bg-white/10 hover:bg-white/20 text-white px-5 py-3 rounded-xl font-semibold text-xs sm:text-sm border border-white/10 transition-all">Add to Queue</button>
                        <button id="add-pl-album-btn" class="bg-white/10 hover:bg-white/20 text-white px-5 py-3 rounded-xl font-semibold text-xs sm:text-sm border border-white/10 transition-all">Add to Playlist</button>
                        <button id="download-album-btn" class="bg-white/10 hover:bg-white/20 text-white px-5 py-3 rounded-xl font-semibold text-xs sm:text-sm border border-white/10 transition-all">Download</button>
                    </div>
                </div>
            </div>

            <div class="space-y-4 w-full">
                <h3 class="text-lg font-bold text-white px-2">Track Listing</h3>
                <div class="space-y-2 w-full">
                    ${album.tracks.map((t, idx) => `
                        <div class="track-row group flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 cursor-pointer transition-all" data-index="${idx}">
                            <div class="flex items-center gap-4 min-w-0 flex-1">
                                <span class="text-xs font-mono text-slate-500 w-6 text-center">${t.track || idx + 1}</span>
                                <div class="min-w-0 flex-1">
                                    <h4 class="font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors">${t.title}</h4>
                                    <p class="text-[11px] text-slate-400 truncate">${t.artist}</p>
                                </div>
                            </div>
                            <span class="text-xs font-mono text-slate-400 ml-4">${t.duration ? formatTime(t.duration) : "??:??"}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        </div>
    `;

    const heroArtistLink = container.querySelector("#hero-artist-link");
    if (heroArtistLink) heroArtistLink.onclick = () => navigateTo(`#/ar/${encodeURIComponent(artistName)}`);
    
    const playAlbumBtn = container.querySelector("#play-album-btn");
    if (playAlbumBtn) playAlbumBtn.onclick = () => executePlaybackQueue(album.tracks, 0, false);
    
    const shuffleAlbumBtn = container.querySelector("#shuffle-album-btn");
    if (shuffleAlbumBtn) shuffleAlbumBtn.onclick = () => {
        /*const shuffled = [...album.tracks].sort(() => Math.random() - 0.5);
        executePlaybackQueue(shuffled, 0, true);*/
        State.isShuffling = false;
        $("shuffle-btn").click();
        
        executePlaybackQueue(album.tracks, 0, true);
        $("next-track").click();
    };

    const addQueueAlbumBtn = container.querySelector("#add-queue-album-btn");
    if (addQueueAlbumBtn) addQueueAlbumBtn.onclick = () => {
        State.queue.push(...album.tracks);
        showToast(`Added ${album.tracks.length} tracks to queue`);
    };

    const addPlAlbumBtn = container.querySelector("#add-pl-album-btn");
    if (addPlAlbumBtn) addPlAlbumBtn.onclick = () => openPlaylistModal(album.tracks);

    const downloadAlbumBtn = container.querySelector("#download-album-btn");
    if (downloadAlbumBtn) downloadAlbumBtn.onclick = () => downloadTracksAsZip(album.tracks, album.title);

    container.querySelectorAll(".track-row").forEach((row, idx) => {
        row.onclick = () => executePlaybackQueue(album.tracks, idx, false);
    });
}

function renderArtistView(container, artistName) {
    const artist = State.library.find(a => a.name === artistName);
    if (!artist) {
        container.innerHTML = `<div class="py-20 text-center text-rose-400">Artist not found.</div>`;
        return;
    }

    container.innerHTML = `
        <div class="space-y-10 w-full max-w-7xl mx-auto px-4 sm:px-6">
            <div class="flex flex-col md:flex-row items-center md:items-end gap-8 bg-gradient-to-b from-[var(--accent)]/15 via-transparent to-transparent p-6 sm:p-10 rounded-3xl border border-white/10 backdrop-blur-2xl w-full">
                <img src="${encodeURI(artist.img)}" class="w-44 h-44 sm:w-56 sm:h-56 object-cover rounded-full shadow-2xl border border-white/15 flex-shrink-0" alt="${artist.name}">
                <div class="space-y-3.5 text-center md:text-left flex-1">
                    <span class="text-[11px] uppercase tracking-widest font-bold" style="color: var(--accent);">Verified Artist</span>
                    <h2 class="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">${artist.name}</h2>
                    <div class="flex flex-wrap justify-center md:justify-start items-center gap-3 text-xs text-slate-400 font-mono">
                        <span>${artist.popularity || "-1"} Followers</span>
                        <span>•</span>
                        <span>${artist.genre || "Unknown Genre"}</span>
                        <span>•</span>
                        <span>Active: ${artist.active || "Unknown Era"}</span>
                    </div>
                </div>
            </div>

            <div class="space-y-5 w-full">
                <h3 class="text-xl font-bold text-white px-2">Discography</h3>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5 w-full">
                    ${artist.albums.map(alb => `
                        <div class="card group relative bg-[#121218] hover:bg-[#1a1a24] border border-white/10 rounded-2xl p-3.5 cursor-pointer transition-all duration-300 shadow-xl flex flex-col justify-between" data-type="album" data-artist="${encodeURIComponent(artist.name)}" data-album="${encodeURIComponent(alb.title)}">
                            <div>
                                <div class="card-img relative aspect-square rounded-xl overflow-hidden bg-slate-800 mb-3 shadow-md">
                                    <img src="${encodeURI(alb.cover)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" alt="${alb.title}">
                                    <button class="play-card-btn absolute bottom-2.5 right-2.5 w-9 h-9 rounded-xl font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-110" style="background-color: var(--accent); color: var(--bg);">
                                        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                                    </button>
                                </div>
                                <h3 class="card-title font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors${alb.explicit ? ' text-rose-400' : ''}">${alb.title}</h3>
                            </div>
                            <p class="card-sub text-[11px] text-slate-400 truncate mt-1">${artist.name}</p>
                        </div>
                    `).join("")}
                </div>
            </div>
        </div>
    `;
}

function renderPlaylistView(container, playlistId) {
    const playlist = State.playlists.find(p => p.id === playlistId);
    if (!playlist) {
        container.innerHTML = `<div class="py-20 text-center text-rose-400">Playlist not found.</div>`;
        return;
    }

    const totalDurationSecs = playlist.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);

    container.innerHTML = `
        <div class="space-y-10 w-full max-w-7xl mx-auto px-4 sm:px-6">
            <div class="flex flex-col md:flex-row items-start md:items-end justify-between bg-gradient-to-b from-[var(--accent)]/15 via-transparent to-transparent p-6 sm:p-10 rounded-3xl border border-white/10 backdrop-blur-2xl gap-6 w-full">
                <div class="space-y-3">
                    <span class="text-[11px] uppercase tracking-widest font-bold" style="color: var(--accent);">Custom Playlist</span>
                    <h2 class="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">${playlist.name}</h2>
                    <div class="flex items-center gap-3 text-xs text-slate-400 font-mono">
                        <span>${playlist.tracks.length} tracks</span>
                        <span>•</span>
                        <span>${totalDurationSecs ? `~${Math.round(totalDurationSecs / 60)} mins` : "??:??"}</span>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <button id="play-pl-btn" style="background-color: var(--accent); color: var(--bg);" class="px-6 py-3 rounded-xl font-bold text-xs sm:text-sm shadow-xl transition-all hover:opacity-90">Play Playlist</button>
                    <button id="download-pl-btn" class="bg-white/10 hover:bg-white/20 text-white px-5 py-3 rounded-xl font-semibold text-xs sm:text-sm border border-white/10 transition-all">Download</button>
                    <button id="delete-pl-btn" class="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 px-5 py-3 rounded-xl font-semibold text-xs sm:text-sm border border-rose-500/30 transition-all">Delete</button>
                </div>
            </div>

            <div class="space-y-4 w-full">
                <h3 class="text-lg font-bold text-white px-2">Tracks</h3>
                <div class="space-y-2 w-full">
                    ${playlist.tracks.length === 0 ? `
                        <div class="py-20 text-center text-slate-400 bg-white/[0.02] rounded-3xl border border-white/5">This playlist is currently empty. Add tracks from any album or search result via right-click.</div>
                    ` : playlist.tracks.map((t, idx) => `
                        <div class="track-row group flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 cursor-pointer transition-all" data-index="${idx}">
                            <div class="flex items-center gap-4 min-w-0 flex-1">
                                <span class="text-xs font-mono text-slate-500 w-6 text-center">${idx + 1}</span>
                                <div class="min-w-0 flex-1">
                                    <h4 class="font-semibold text-white text-xs sm:text-sm truncate group-hover:text-[var(--accent)] transition-colors">${t.title}</h4>
                                    <p class="text-[11px] text-slate-400 truncate">${t.artist} •${t.album}</p>
                                </div>
                            </div>
                            <span class="text-xs font-mono text-slate-400 ml-4">${t.duration ? formatTime(t.duration) : "??:??"}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        </div>
    `;

    const playPlBtn = container.querySelector("#play-pl-btn");
    if (playPlBtn) playPlBtn.onclick = () => { if (playlist.tracks.length) executePlaybackQueue(playlist.tracks, 0, true); };
    
    const downloadPlBtn = container.querySelector("#download-pl-btn");
    if (downloadPlBtn) downloadPlBtn.onclick = () => downloadTracksAsZip(playlist.tracks, playlist.name);
    
    const deletePlBtn = container.querySelector("#delete-pl-btn");
    if (deletePlBtn) deletePlBtn.onclick = () => {
        State.playlists = State.playlists.filter(p => p.id !== playlist.id);
        localStorage.setItem("sigma_playlists", JSON.stringify(State.playlists));
        showToast("Playlist deleted");
        navigateTo("#/");
    };

    container.querySelectorAll(".track-row").forEach((row, idx) => {
        row.onclick = () => executePlaybackQueue(playlist.tracks, idx, true);
    });
}

// Global Click Delegation & Card Activation
document.body.addEventListener("click", e => {
    const card = e.target.closest(".card");
    if (card) {
        const type = card.dataset.type;
        if (type === "album") {
            if (e.target.closest(".play-card-btn")) {
                const artist = decodeURIComponent(card.dataset.artist);
                const album = decodeURIComponent(card.dataset.album);
                const albObj = findTargetAlbum(artist, album);
                if (albObj) executePlaybackQueue(albObj.tracks, 0, false);
            } else {
                const artist = decodeURIComponent(card.dataset.artist);
                const album = decodeURIComponent(card.dataset.album);
                navigateTo(`#/al/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`);
            }
        } else if (type === "artist") {
            const artist = decodeURIComponent(card.dataset.artist);
            navigateTo(`#/ar/${encodeURIComponent(artist)}`);
        } else if (type === "playlist") {
            const plId = card.dataset.id;
            navigateTo(`#/pl/${plId}`);
        }
        return;
    }

    const playCardBtn = e.target.closest(".play-card-btn");
    if (playCardBtn) {
        e.stopPropagation();
        const cardElem = playCardBtn.closest(".card");
        if (!cardElem) return;
        const type = cardElem.dataset.type;
        if (type === "album") {
            const artist = decodeURIComponent(cardElem.dataset.artist);
            const album = decodeURIComponent(cardElem.dataset.album);
            const albObj = findTargetAlbum(artist, album);
            if (albObj) executePlaybackQueue(albObj.tracks, 0, false);
        } else if (type === "playlist") {
            const plObj = State.playlists.find(p => p.id === cardElem.dataset.id);
            if (plObj && plObj.tracks.length) executePlaybackQueue(plObj.tracks, 0, true);
        }
        return;
    }

    const trackRow = e.target.closest(".track-row");
    if (trackRow && trackRow.dataset.file) {
        const file = decodeURIComponent(trackRow.dataset.file);
        const allTr = getFlattenedTracks();
        const trackObj = allTr.find(t => t.file === file);
        if (trackObj) executePlaybackQueue([trackObj], 0, false);
    }
});

// Context Menu Setup
const contextMenu = $("context-menu");

window.addEventListener("click", () => { if (contextMenu) contextMenu.classList.add("hidden"); });
window.addEventListener("scroll", () => { if (contextMenu) contextMenu.classList.add("hidden"); });

document.body.addEventListener("contextmenu", e => {
    const card = e.target.closest(".card");
    const trackRow = e.target.closest(".track-row");

    if (!card && !trackRow || !contextMenu) return;

    e.preventDefault();
    State.contextMenuTarget = { card, trackRow };

    let menuHTML = "";

    if (card) {
        const type = card.dataset.type;
        if (type === "album") {
            const artist = decodeURIComponent(card.dataset.artist);
            const album = decodeURIComponent(card.dataset.album);
            menuHTML = `
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('play-album', '${encodeURIComponent(artist)}', '${encodeURIComponent(album)}')">Play Album</div>
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('queue-album', '${encodeURIComponent(artist)}', '${encodeURIComponent(album)}')">Add Album to Queue</div>
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('pl-album', '${encodeURIComponent(artist)}', '${encodeURIComponent(album)}')">Add to Playlist</div>
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('download-album', '${encodeURIComponent(artist)}', '${encodeURIComponent(album)}')">Download Album</div>
                <div class="border-t border-white/10 my-1"></div>
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('view-artist', '${encodeURIComponent(artist)}')">Go to Artist</div>
            `;
        } else if (type === "artist") {
            const artist = decodeURIComponent(card.dataset.artist);
            menuHTML = `
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('play-artist', '${encodeURIComponent(artist)}')">Play Artist Discography</div>
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('view-artist', '${encodeURIComponent(artist)}')">View Artist Profile</div>
            `;
        } else if (type === "playlist") {
            const plId = card.dataset.id;
            menuHTML = `
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('play-playlist', '${plId}')">Play Playlist</div>
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('download-playlist', '${plId}')">Download Playlist</div>
                <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium text-rose-400" onclick="contextAction('delete-playlist', '${plId}')">Delete Playlist</div>
            `;
        }
    } else if (trackRow) {
        menuHTML = `
            <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('play-track')">Play Track</div>
            <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('queue-track')">Add to Queue</div>
            <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('pl-track')">Add to Playlist</div>
            <div class="px-4 py-2.5 hover:bg-white/10 cursor-pointer font-medium" onclick="contextAction('download-track')">Download Track</div>
        `;
    }

    contextMenu.innerHTML = menuHTML;
    contextMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
    contextMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 250)}px`;
    contextMenu.classList.remove("hidden");
});

window.contextAction = function(action, arg1, arg2) {
    if (contextMenu) contextMenu.classList.add("hidden");
    const { card, trackRow } = State.contextMenuTarget || {};

    if (action.startsWith("play-album")) {
        const alb = findTargetAlbum(decodeURIComponent(arg1), decodeURIComponent(arg2));
        if (alb) executePlaybackQueue(alb.tracks, 0, false);
    } else if (action.startsWith("queue-album")) {
        const alb = findTargetAlbum(decodeURIComponent(arg1), decodeURIComponent(arg2));
        if (alb) {
            State.queue.push(...alb.tracks);
            showToast(`Added ${alb.tracks.length} tracks to queue`);
        }
    } else if (action.startsWith("pl-album")) {
        const alb = findTargetAlbum(decodeURIComponent(arg1), decodeURIComponent(arg2));
        if (alb) openPlaylistModal(alb.tracks);
    } else if (action.startsWith("download-album")) {
        const alb = findTargetAlbum(decodeURIComponent(arg1), decodeURIComponent(arg2));
        if (alb) downloadTracksAsZip(alb.tracks, alb.title);
    } else if (action.startsWith("view-artist")) {
        navigateTo(`#/ar/${arg1}`);
    } else if (action.startsWith("play-artist")) {
        const art = State.library.find(a => a.name === decodeURIComponent(arg1));
        if (art) {
            const allTracks = art.albums.flatMap(al => al.tracks);
            if (allTracks.length) executePlaybackQueue(allTracks, 0, false);
        }
    } else if (action.startsWith("play-playlist")) {
        const pl = State.playlists.find(p => p.id === arg1);
        if (pl && pl.tracks.length) executePlaybackQueue(pl.tracks, 0, true);
    } else if (action.startsWith("download-playlist")) {
        const pl = State.playlists.find(p => p.id === arg1);
        if (pl) downloadTracksAsZip(pl.tracks, pl.name);
    } else if (action.startsWith("delete-playlist")) {
        State.playlists = State.playlists.filter(p => p.id !== arg1);
        localStorage.setItem("sigma_playlists", JSON.stringify(State.playlists));
        showToast("Playlist deleted");
        navigateTo("#/");
    } else if (action === "play-track" || action === "queue-track" || action === "pl-track" || action === "download-track") {
        let track = null;
        if (trackRow && trackRow.dataset.file) {
            const file = decodeURIComponent(trackRow.dataset.file);
            track = getFlattenedTracks().find(t => t.file === file);
        } else if (trackRow && trackRow.dataset.index !== undefined) {
            const idx = Number(trackRow.dataset.index);
            const route = getRouteFromHash();
            if (route.view === "album") {
                track = findTargetAlbum(route.artistName, route.albumTitle)?.tracks[idx];
            } else if (route.view === "playlist") {
                track = State.playlists.find(p => p.id === route.playlistId)?.tracks[idx];
            }
        }
        if (!track && State.queue.length) track = State.queue[State.index];

        if (track) {
            if (action === "play-track") executePlaybackQueue([track], 0, false);
            if (action === "queue-track") {
                State.queue.push(track);
                showToast(`Added "${track.title}" to queue`);
            }
            if (action === "pl-track") openPlaylistModal([track]);
            if (action === "download-track") downloadTracksAsZip([track], track.title);
        }
    }
};

// Playlist Selection Modal
function openPlaylistModal(tracksToAdd) {
    const modal = $("playlist-modal");
    const list = $("pl-modal-list");
    if (!modal || !list) return;

    if (State.playlists.length === 0) {
        list.innerHTML = `<p class="text-slate-400 text-sm py-4 text-center">No custom playlists exist.</p>`;
    } else {
        list.innerHTML = State.playlists.map(pl => `
            <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-all" onclick="addToPlaylistId('${pl.id}')">
                <span class="font-semibold text-white text-sm">${pl.name}</span>
                <span class="text-xs text-slate-400">${pl.tracks.length} tracks</span>
            </div>
        `).join("");
    }

    modal.classList.remove("hidden");
    modal.classList.add("flex");

    window.addToPlaylistId = (plId) => {
        const pl = State.playlists.find(p => p.id === plId);
        if (pl) {
            pl.tracks.push(...tracksToAdd);
            localStorage.setItem("sigma_playlists", JSON.stringify(State.playlists));
            showToast(`Added ${tracksToAdd.length} track(s) to "${pl.name}"`);
            closePlaylistModal();
        }
    };
}

function closePlaylistModal() {
    const modal = $("playlist-modal");
    if (!modal) return;
    modal.classList.remove("flex");
    modal.classList.add("hidden");
}

const closePlModalBtn = $("close-pl-modal");
if (closePlModalBtn) closePlModalBtn.onclick = closePlaylistModal;

const createPlModalBtn = $("create-pl-from-modal");
if (createPlModalBtn) {
    createPlModalBtn.onclick = () => {
        const newId = 'pl_' + Math.random().toString(36).substring(2, 9);
        const newPl = { id: newId, name: `New Playlist #${State.playlists.length + 1}`, tracks: [] };
        State.playlists.push(newPl);
        localStorage.setItem("sigma_playlists", JSON.stringify(State.playlists));
        closePlaylistModal();
        showToast("Playlist created");
    };
}

// Batch Download as Zip using JSZip
async function downloadTracksAsZip(tracks, archiveName) {
    if (!tracks.length) return;
    showToast(`Preparing ZIP archive for ${archiveName}...`);

    if (tracks.length === 1) {
        try {
            const res = await fetch(tracks[0].file);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${tracks[0].title} - ${tracks[0].artist}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("Download completed");
        } catch (err) {
            console.error("Download failed:", err);
            showToast("Download failed", "error");
        }
        return;
    }

    try {
        const zip = new JSZip();
        const folder = zip.folder(archiveName.replace(/[^a-z0-9]/gi, '_').toLowerCase());

        for (const t of tracks) {
            const res = await fetch(t.file);
            const blob = await res.blob();
            const filename = `${t.track || ''} ${t.title} - ${t.artist}.mp3`.trim();
            folder.file(filename, blob);
        }

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${archiveName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("ZIP archive downloaded successfully");
    } catch (err) {
        console.error("ZIP Generation error:", err);
        showToast("Failed to generate ZIP archive", "error");
    }
}

// Playback Engine & Gapless Preloading
function initializeAudioGraph() {
    if (State.audioCtx) return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        State.audioCtx = new AudioContextClass();
        State.analyser = State.audioCtx.createAnalyser();
        State.analyser.fftSize = 256;

        const sourceNode = State.audioCtx.createMediaElementSource(audio);
        sourceNode.connect(State.analyser);
        State.analyser.connect(State.audioCtx.destination);
    } catch (e) {
        console.warn("Web Audio API warning:", e);
    }
    beginRenderAnimationLoop();
}

function executePlaybackQueue(trackList, startIndex = 0, preserveShuffle = false) {
    initializeAudioGraph();
    if (State.audioCtx && State.audioCtx.state === "suspended") {
        State.audioCtx.resume();
    }

    State.queue = trackList;
    State.index = startIndex;

    if (!preserveShuffle) {
        State.isShuffling = false;
        const shuffleIndicator = $("shuffle-indicator");
        const shuffleBtn = $("shuffle-btn");
        if (shuffleIndicator) shuffleIndicator.classList.add("hidden");
        if (shuffleBtn) shuffleBtn.style.color = "";
    }
    
    playCurrentQueueIndex();
}

function playCurrentQueueIndex() {
    if (!State.queue.length) return;
    const track = State.queue[State.index];
    audio.src = track.file;
    updatePlaybackUI(track);
    audio.play().catch(err => console.log("Playback prevented:", err));
    preloadNextTrack();
}

function preloadNextTrack() {
    if (!State.queue.length) return;
    const nextIdx = State.isShuffling ? Math.floor(Math.random() * State.queue.length) : (State.index + 1) % State.queue.length;
    const nextTrack = State.queue[nextIdx];
    if (nextTrack) {
        preloadAudio.src = nextTrack.file;
        preloadAudio.load();
    }
}

const shiftQueueIndex = direction => {
    if (!State.queue.length) return;
    if (State.isShuffling) {
        State.index = Math.floor(Math.random() * State.queue.length);
    } else {
        State.index = (State.index + direction + State.queue.length) % State.queue.length;
    }
    playCurrentQueueIndex();
};

function updatePlaybackUI(track) {
    if (!track) return;
    const playerTitle = $("player-title");
    const playerArtist = $("player-artist");
    const playerArt = $("player-art");
    const ambientBg = $("ambient-bg");

    if (playerTitle) playerTitle.textContent = track.title;
    if (playerArtist) playerArtist.textContent = `${track.artist} • ${track.album}`;
    if (playerArt) playerArt.src = track.albumC;
    document.title = `${track.title} — ${track.artist} | Σ Music`;
    
    const iconLink = document.querySelector('link[rel="icon"]');
    if (iconLink) iconLink.href = track.albumC;
    if (ambientBg) ambientBg.style.backgroundImage = `url('${encodeURI(track.albumC).replace(/'/g, "%27")}')`;

    if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album,
            artwork: [{ src: track.albumC, sizes: "512x512", type: "image/jpeg" }]
        });
    }
}

audio.onpause = () => { const playToggle = $("play-toggle"); if (playToggle) playToggle.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>`  };
audio.onplay = () => { const playToggle = $("play-toggle"); if (playToggle) playToggle.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>`  };
audio.onended = () => {
    if (State.isLooping) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
    } else {
        shiftQueueIndex(1);
    }
};

audio.ontimeupdate = () => {
    const curr = audio.currentTime;
    const dur = audio.duration;
    const ratio = (curr / dur) * 100 || 0;
    const fillBar = $("fill-bar");
    const timeCurrent = $("time-current");
    const timeTotal = $("time-total");

    if (fillBar) fillBar.style.width = `${ratio}%`;
    if (timeCurrent) timeCurrent.textContent = formatTime(curr);
    if (timeTotal && dur) timeTotal.textContent = formatTime(dur);
};

audio.onloadedmetadata = () => {
    const timeTotal = $("time-total");
    if (timeTotal) timeTotal.textContent = formatTime(audio.duration);
};

// Player Controls Binding
const playToggleBtn = $("play-toggle");
if (playToggleBtn) {
    playToggleBtn.onclick = () => {
        initializeAudioGraph();
        if (State.audioCtx && State.audioCtx.state === "suspended") State.audioCtx.resume();
        if (audio.paused) {
            if (!audio.src && State.queue.length) {
                playCurrentQueueIndex();
            } else {
                audio.play().catch(() => {});
            }
        } else {
            audio.pause();
        }
    };
}

const nextTrackBtn = $("next-track");
if (nextTrackBtn) nextTrackBtn.onclick = () => shiftQueueIndex(1);

const prevTrackBtn = $("prev-track");
if (prevTrackBtn) prevTrackBtn.onclick = () => shiftQueueIndex(-1);

const seekSlider = $("seek-slider");
if (seekSlider) {
    seekSlider.onclick = event => {
        if (!audio.duration || isNaN(audio.duration)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        audio.currentTime = pos * audio.duration;
    };
}

const loopBtn = $("loop-btn");
if (loopBtn) {
    loopBtn.onclick = (e) => {
        State.isLooping = !State.isLooping;
        e.currentTarget.style.color = State.isLooping ? "var(--accent)" : "";
        const indicator = $("loop-indicator");
        if (indicator) indicator.classList.toggle("hidden", !State.isLooping);
    };
}

const shuffleBtn = $("shuffle-btn");
if (shuffleBtn) {
    shuffleBtn.onclick = (e) => {
        State.isShuffling = !State.isShuffling;
        e.currentTarget.style.color = State.isShuffling ? "var(--accent)" : "";
        const indicator = $("shuffle-indicator");
        if (indicator) indicator.classList.toggle("hidden", !State.isShuffling);
    };
}

const volumeSlider = $("volume-slider");
if (volumeSlider) {
    volumeSlider.oninput = (e) => {
        audio.volume = e.target.value;
    };
}

const queueBtn = $("queue-btn");
if (queueBtn) {
    queueBtn.onclick = () => {
        const modal = document.createElement("dialog");
        modal.className = "bg-[#121218] text-white border border-white/15 rounded-3xl p-6 sm:p-8 w-full max-w-xl shadow-2xl backdrop-blur-2xl";
        modal.innerHTML = `
            <div class="flex items-center justify-between mb-6">
                <h3 class="text-lg sm:text-xl font-bold flex items-center gap-2"><span>📜</span> Playback Queue</h3>
                <button class="close-dialog text-slate-400 hover:text-white p-2 text-sm font-semibold">✕ Close</button>
            </div>
            <div class="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                ${State.queue.length === 0 ? `<p class="text-slate-400 text-sm py-8 text-center">Queue is currently empty.</p>` :
                State.queue.map((t, i) => `
                    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5 ${i === State.index ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10' : ''}" style="${i === State.index ? 'color: var(--accent);' : ''}" data-qindex="${i}">
                        <div class="truncate pr-4 min-w-0 flex-1">
                            <p class="font-medium text-sm truncate">${t.title}</p>
                            <p class="text-xs text-slate-400 truncate mt-0.5">${t.artist}</p>
                        </div>
                        <button class="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-medium transition-all flex-shrink-0" onclick="State.queue.splice(${i}, 1); if (State.index >= ${i}) State.index = Math.max(0, State.index - 1); this.closest('dialog').remove(); showToast('Removed from queue');">Remove</button>
                        <button class="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-medium transition-all flex-shrink-0 ml-2" onclick="executePlaybackQueue(State.queue, ${i}, true); this.closest('dialog').close();">Play</button>
                    </div>
                `).join("")}
            </div>
        `;
        document.body.appendChild(modal);
        modal.showModal();
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.close();
                modal.remove();
            }
        };
        modal.querySelector(".close-dialog").onclick = () => {
            modal.close();
            modal.remove();
        };
    };
}

const lyricsBtn = $("lyrics-btn");
if (lyricsBtn) {
    lyricsBtn.onclick = () => {
        const modal = document.createElement("dialog");
        modal.className = "bg-[#121218] text-white border border-white/15 rounded-3xl p-6 sm:p-8 w-full max-w-lg shadow-2xl backdrop-blur-2xl";
        const currentTrack = State.queue[State.index];
        modal.innerHTML = `
            <div class="flex items-center justify-between mb-6">
                <h3 class="text-lg sm:text-xl font-bold flex items-center gap-2"><span>📝</span> Live Synced Lyrics</h3>
                <button class="close-dialog text-slate-400 hover:text-white p-2 text-sm font-semibold">✕ Close</button>
            </div>
            <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-2 text-slate-300">
                ${!currentTrack ? `<p class="italic text-slate-500 text-center py-6">No track currently playing.</p>` : `
                    <div class="p-4 rounded-2xl mb-4 border border-[var(--accent)]/30" style="background-color: color-mix(in srgb, var(--accent) 10%, transparent);">
                        <p class="font-bold text-base" style="color: var(--accent);">${currentTrack.title}</p>
                        <p class="text-xs text-slate-300 mt-1">${currentTrack.artist} •${currentTrack.album}</p>
                    </div>
                    <div class="space-y-4 text-sm text-slate-300 leading-relaxed pt-2">
                        <p class="text-slate-500 font-mono text-xs">🎵 [Instrumental Ambient Intro]</p>
                        <p>Echoes flowing through the quantum stream...</p>
                        <p>Frequencies aligning in harmonic synchronization across the grid...</p>
                        <p class="text-slate-500 font-mono text-xs">🎵 [Synth Waveform Resonance]</p>
                        <p>Infinite cycles looping through space and time...</p>
                        <p>Pure analog warmth captured in digital perfection.</p>
                    </div>
                `}
            </div>
        `;
        document.body.appendChild(modal);
        modal.showModal();
        modal.querySelector(".close-dialog").onclick = () => {
            modal.close();
            modal.remove();
        };
    };
}

const fullscreenBtn = $("fullscreen-btn");
if (fullscreenBtn) {
    fullscreenBtn.onclick = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    };
}

const randomBtn = $("random");
if (randomBtn) {
    randomBtn.onclick = () => {
        /*
        const tracks = getFlattenedTracks();
        if (tracks.length) {
            const randIdx = Math.floor(Math.random() * tracks.length);
            executePlaybackQueue([tracks[randIdx]], 0, false);
        }
        */
       allTracks = getFlattenedTracks();
       if (allTracks.length) {
           const randIdx = Math.floor(Math.random() * allTracks.length);
           executePlaybackQueue(allTracks, randIdx, false);
       }
    };
}

const openCurrentAlbum = () => {
    const track = State.queue[State.index];
    const album = track
        ? { artist: track.artist, title: track.album }
        : getFlattenedAlbums()[0];

    if (album) {
        navigateTo(`#/al/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`);
    }
};

const openCurrentArtist = () => {
    const track = State.queue[State.index];
    const artist = track ? track.artist : getFlattenedAlbums()[0]?.artist;

    if (artist) {
        navigateTo(`#/ar/${encodeURIComponent(artist)}`);
    }
};

document.querySelectorAll(".open-current-album")
    .forEach(el => el.addEventListener("click", openCurrentAlbum));

document.querySelectorAll(".open-current-artist")
    .forEach(el => el.addEventListener("click", openCurrentArtist));

// Canvas Visualizer Procedural Animation Engine
const canvas = document.getElementById("visualizer") || $("visualizer");
const ctx = canvas ? canvas.getContext("2d", { alpha: true }) : null;

let accentColor;
let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;

const resizeCanvas = () => {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvasWidth = canvas.width;
    canvasHeight = canvas.height;
    
    // Cache the CSS accent color once on resize/load instead of inside the render loop
    const computedAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (computedAccent) accentColor = computedAccent;
};

window.addEventListener("resize", resizeCanvas, { passive: true });
resizeCanvas();

function beginRenderAnimationLoop() {
    requestAnimationFrame(beginRenderAnimationLoop);
    if (!ctx || !canvas) return;
    
    State.vTime += 0.016;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const maxBins = 50; // Optimized count for lower-end devices
    let freqData = new Uint8Array(maxBins);
    
    if (State.analyser) {
        freqData = new Uint8Array(State.analyser.frequencyBinCount);
        State.analyser.getByteFrequencyData(freqData);
    } else {
        for (let i = 0; i < maxBins; i++) {
            freqData[i] = Math.sin(State.vTime + i * 0.2) * 40 + 50;
        }
    }

    const step = Math.max(1, Math.floor(freqData.length / maxBins));
    const bins = Math.ceil(freqData.length / step);
    const slotW = canvasWidth / bins;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 24px 'Inter', sans-serif";

    for (let i = 0, b = 0; i < freqData.length; i += step, b++) {
        const amp = freqData[i] / 255;
        const x = (b * slotW) + (slotW / 2);
        const y = canvasHeight - 120 - (amp * (canvasHeight * 0.35));
        const waveY = y + Math.sin((State.vTime * 2) + (b * 0.15)) * 10;
        const angle = ((State.vTime * 2) + (b * 0.2) + (amp * 0.4)) % 6.283185; // Math.PI * 2 cached

        // Reuse cached gradient line per item
        const grad = ctx.createLinearGradient(x, waveY - 20, x, waveY + 20);
        grad.addColorStop(0, accentColor);
        grad.addColorStop(1, "#94a3b8");

        ctx.save();
        ctx.translate(x, waveY);
        ctx.rotate(angle);
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.2 + (amp * 0.5);
        ctx.fillText("Σ", 0, 0);
        ctx.restore();
    }
    ctx.globalAlpha = 1.0;
}

// Initialization Async Launcher
(async () => {
    try {
        const res = await fetch("m.json");
        if (!res.ok) throw new Error("Failed to load music data endpoint.");
        const json = await res.json();

        State.library = Object.entries(json).map(([name, data]) => ({
            ...data,
            name,
            img: data.location + "icon.png",
            genre: data.genre || "Unknown Genre",
            description: data.description || "",
            albums: (data.albums || []).map(alb => {
                if (!alb.apple_album) alb.apple_album = { tracks: [], apple_music: {} };
                const title = alb.dname || alb.name || "Untitled Album";
                const cover = alb.cover || `${data.location}${alb.name}/cover.jpg`;
                return {
                    explicit: alb.explicit || false,
                    title,
                    cover: cover,
                    date: alb.date || new Date(alb.apple_album.releaseDate).toLocaleDateString() || "Unknown Date",
                    description: alb.description || alb.apple_album.apple_music.album_url || "",
                    tracks: (alb.tracks || []).map(t => ({
                        ...t,
                        artist: name,
                        album: title,
                        duration: t.duration || alb.apple_album.tracks[t.track - 1]?.trackTimeMillis * 0.001 || 0,
                        file: data.location + t.url || alb.apple_album.tracks[t.track - 1]?.previewUrl,
                        albumC: cover
                    }))
                };
            })
        }));

        State.fuse = new Fuse(getFlattenedTracks(), {
            keys: ["title", "artist", "album"],
            threshold: 0.35
        });

        renderCurrentRoute();
    } catch (err) {
        console.error(err);
        const mainEl = document.querySelector("main");
        if (mainEl) {
            mainEl.innerHTML = `<p class="text-rose-400 p-12 text-center text-lg">Failed to load music library. Please ensure music data is accessible.</p>`;
        }
    }
})();

// Start the render loop once (removed duplicate call)
beginRenderAnimationLoop();

// Global Keyboard Shortcuts
document.addEventListener("keydown", e => {
    const target = e.target;
    const isTyping = target instanceof HTMLElement && (
        target.isContentEditable ||
        target.matches("input, textarea, select") ||
        target.closest('[contenteditable="true"]')
    );

    if (isTyping) {
        if (e.code === "Escape" && target.matches("#search") && target.value === "") {
            target.blur();
        }
        return;
    }

    switch (e.code) {
        case "Space":
            e.preventDefault();
            const playToggle = $("play-toggle");
            if (playToggle) playToggle.click();
            break;

        case "Escape": {
            const openDialog = document.querySelector("dialog[open]");
            if (openDialog) {
                openDialog.close();
                openDialog.remove();
                return;
            }

            const playlistModal = $("playlist-modal");
            if (playlistModal && !playlistModal.classList.contains("hidden")) {
                closePlaylistModal();
                return;
            }

            const ctxMenu = $("context-menu");
            if (ctxMenu && !ctxMenu.classList.contains("hidden")) {
                ctxMenu.classList.add("hidden");
                return;
            }

            navigateTo("#/");
            break;
        }

        case "Slash":
            e.preventDefault();
            const searchBox = $("search");
            if (searchBox) searchBox.focus();
            break;

        case "ArrowRight":
            audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || audio.currentTime);
            break;
        case "ArrowLeft":
            audio.currentTime = Math.max(audio.currentTime - 5, 0);
            break;

        case "KeyR":
            if (e.ctrlKey || e.metaKey) return;
            const randBtn = $("random");
            if (randBtn) randBtn.click();
            break;

        case "KeyQ":
            openCurrentAlbum();
            break;

        case "KeyW":
            openCurrentArtist();
            break;

        case "KeyE":
            navigateTo("#/");
            break;

        default:
            break;
    }
});

if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => { const pt = $("play-toggle"); if (pt) pt.click(); });
    navigator.mediaSession.setActionHandler("pause", () => { const pt = $("play-toggle"); if (pt) pt.click(); });
    navigator.mediaSession.setActionHandler("previoustrack", () => { const pt = $("prev-track"); if (pt) pt.click(); });
    navigator.mediaSession.setActionHandler("nexttrack", () => { const pt = $("next-track"); if (pt) pt.click(); });
}

// ask user if they want to leave if audio is playing
window.addEventListener("beforeunload", e => {
    if (!audio.paused) {
        e.preventDefault();
    }
});