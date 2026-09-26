(() => {
"use strict";

// Standard DOM Cache selectors helper
const $ = id => document.getElementById(id);
const audio = $("audio");

// Unified Application Ecosystem State Struct
const State = {
    library: [],
    queue: [],
    index: 0,
    audioCtx: null,
    analyser: null,
    vTime: 0,
    fuse: null
};

// Humanize parsing digital audio runtimes
const formatTime = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
};

const getFlattenedAlbums = () => State.library.flatMap(art => art.albums.map(alb => ({ ...alb, artist: art.name })));
const getFlattenedTracks = () => State.library.flatMap(art => art.albums.flatMap(alb => alb.tracks));
const findTargetAlbum = (artistName, albumTitle) => State.library.find(a => a.name === artistName)?.albums.find(al => al.title === albumTitle);

/**
 * Card Component Template Builder Engine
 */
const createCardHTML = ({ type, title, subtitle, imgPath, artist = "", album = "", file = "" }) => {
    const classType = type === "artist" ? "artist-type" : "";
    return `
    <article class="card ${classType}" data-type="${type}" data-artist="${encodeURIComponent(artist || title)}" data-album="${encodeURIComponent(album || title)}" data-file="${encodeURIComponent(file)}">
        <div class="card-img">
        <img src="${encodeURI(imgPath)}" loading="lazy" alt="${title}">
        </div>
        <div class="card-title">${title}</div>
        <div class="card-sub">${subtitle}</div>
    </article>
    `;
};

/**
 * Engine Renderer Component
 */
function renderLibraryGrid(query = "") {
    const cleanQuery = query.toLowerCase().trim();
    const allAlbums = getFlattenedAlbums();

    const filteredArtists = State.library.filter(art => !cleanQuery || art.name.toLowerCase().includes(cleanQuery));
    const filteredAlbums = allAlbums.filter(alb => !cleanQuery || alb.title.toLowerCase().includes(cleanQuery) || alb.artist.toLowerCase().includes(cleanQuery));
    const filteredTracks = cleanQuery ? State.fuse.search(cleanQuery).map(res => res.item) : allAlbums.flatMap(a => a.tracks);

    let htmlOutput = "";

    if (filteredArtists.length) {
    htmlOutput += `<div class="section-title">Artists</div><div class="grid">`;
    htmlOutput += filteredArtists.map(art => createCardHTML({
        type: "artist",
        title: art.name,
        subtitle: `${art.albums.length} albums • ${art.albums.flatMap(al => al.tracks).length} tracks`,
        imgPath: art.img
    })).join("");
    htmlOutput += `</div>`;
    }

    if (filteredAlbums.length) {
    htmlOutput += `<div class="section-title">Albums</div><div class="grid">`;
    htmlOutput += filteredAlbums.map(alb => createCardHTML({
        type: "album",
        title: alb.title,
        subtitle: alb.artist,
        imgPath: alb.cover,
        artist: alb.artist,
        album: alb.title
    })).join("");
    htmlOutput += `</div>`;
    }

    if (filteredTracks.length) {
    htmlOutput += `<div class="section-title">Tracks</div><div class="grid">`;
    htmlOutput += filteredTracks.map(track => createCardHTML({
        type: "track",
        title: track.title,
        subtitle: `${track.artist} • ${track.album}`,
        imgPath: track.albumC,
        artist: track.artist,
        album: track.album,
        file: track.file
    })).join("");
    htmlOutput += `</div>`;
    }

    $("results").innerHTML = htmlOutput || `<div style="padding: 24px 0; color: var(--text-dim)">No results found.</div>`;
}

/**
 * Modern UI Dialogue Controller Module
 */
function openViewerDialog(type, artistName, albumTitle = null) {
    const artist = State.library.find(a => a.name === artistName);
    if (!artist) return;

    const dialog = $("viewer-dialog");
    const content = $("dialog-content");

    if (type === "artist") {
    content.innerHTML = `
        <div class="hero">
        <img src="${encodeURI(artist.img)}" style="border-radius: 50%" alt="${artist.name}">
        <div class="hero-details">
            <h2>${artist.name}</h2>
            <button class="btn play-btn" data-action="play-artist" data-artist="${encodeURIComponent(artist.name)}">Play Artist Discography</button>
        </div>
        </div>
        <div class="section-title">Albums</div>
        <div class="grid">
        ${artist.albums.map(al => createCardHTML({
            type: "album",
            title: al.title,
            subtitle: artist.name,
            imgPath: al.cover,
            artist: artist.name,
            album: al.title
        })).join("")}
        </div>
    `;
    dialog.showModal();
    return;
    }

    const album = findTargetAlbum(artistName, albumTitle);
    if (!album) return;

    const currentActiveTrackFile = State.queue[State.index]?.file;

    content.innerHTML = `
    <div class="hero">
        <img data-action="view-artist" data-artist="${encodeURIComponent(artist.name)}" src="${encodeURI(album.cover)}" alt="${album.title}" style="cursor: pointer;">
        <div class="hero-details">
        <h2>${album.title}</h2>
        <p class="clickable view-artist-trigger" data-action="view-artist" data-artist="${encodeURIComponent(artist.name)}">${artist.name}</p>
        <div>
            <button class="btn play-btn" data-action="play-album" data-artist="${encodeURIComponent(artist.name)}" data-album="${encodeURIComponent(album.title)}">Play Album</button>
        </div>
        </div>
    </div>
    <div class="track-list">
        ${album.tracks.map((t, idx) => {
        const isActive = currentActiveTrackFile === t.file ? "active" : "";
        return `
            <div class="track-row ${isActive}" data-action="play-track-row" data-artist="${encodeURIComponent(artist.name)}" data-album="${encodeURIComponent(album.title)}" data-index="${idx}">
            <span class="track-index">${t.track || idx + 1}</span>
            <span class="track-title">${t.title}</span>
            <span class="track-duration">${t.duration ? formatTime(t.duration) : ""}</span>
            </div>
        `;
        }).join("")}
    </div>
    `;
    dialog.showModal();
}

function handleCardActivation(cardElement) {
    const type = cardElement.dataset.type;
    const artist = decodeURIComponent(cardElement.dataset.artist || "");
    const album = decodeURIComponent(cardElement.dataset.album || "");
    const file = decodeURIComponent(cardElement.dataset.file || "");

    if (type === "track") {
    const matchingTrack = findTargetAlbum(artist, album)?.tracks.find(t => t.file === file);
    if (matchingTrack) executePlaybackQueue([matchingTrack], 0);
    } else {
    openViewerDialog(type, artist, album);
    }
}

function updatePlaybackUI(track) {
    if (!track) return;
    $("status").textContent = `${track.title} - ${track.album} - ${track.artist}`;
    document.title = `${track.title} — ${track.artist}`;
    
    // Dynamic App branding icon adjustment matches tracking art node assets
    const targetCover = track.albumC;
    document.querySelector('link[rel="icon"]').href = targetCover;
    $("ambient-bg").style.backgroundImage = `url('${encodeURI(targetCover)}')`;

    // Synchronization state layout highlights
    document.querySelectorAll(".track-row").forEach(row => {
    const rowTitle = row.querySelector(".track-title")?.textContent;
    row.classList.toggle("active", rowTitle === track.title);
    });

    if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: [{ src: targetCover, sizes: "512x512", type: "image/jpeg" }]
    });
    }
}

/**
 * Web Audio API Analysis Pipeline Pipeline Module
 */
function initializeAudioGraph() {
    if (State.audioCtx) return;
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    State.audioCtx = new AudioContextClass();
    State.analyser = State.audioCtx.createAnalyser();
    State.analyser.fftSize = 256;

    const sourceNode = State.audioCtx.createMediaElementSource(audio);
    sourceNode.connect(State.analyser);
    State.analyser.connect(State.audioCtx.destination);
    
    beginRenderAnimationLoop();
}

function executePlaybackQueue(trackList, startIndex = 0) {
    initializeAudioGraph();
    State.queue = trackList;
    State.index = startIndex;
    
    audio.src = State.queue[State.index].file;
    updatePlaybackUI(State.queue[State.index]);
    audio.play().catch(() => console.log("User interaction required prior to automated streaming initialized media layers."));
}

const shiftQueueIndex = direction => {
    if (!State.queue.length) return;
    State.index = (State.index + direction + State.queue.length) % State.queue.length;
    audio.src = State.queue[State.index].file;
    updatePlaybackUI(State.queue[State.index]);
    audio.play().catch(() => {});
};

/**
 * Global Application Context Click Router Events Delegations
 */
document.body.addEventListener("click", event => {
    // Main Core Container Card Click Target Handler Router
    const targetCard = event.target.closest(".container .card");
    if (targetCard) {
    handleCardActivation(targetCard);
    return;
    }

    // Dialog Intercept Layer Handler Router
    const targetDialogCard = event.target.closest("#viewer-dialog .card");
    if (targetDialogCard) {
    handleCardActivation(targetDialogCard);
    return;
    }

    // Action Attribute Delegation Routing Matrix Target Router
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;

    const action = actionElement.dataset.action;
    const artist = decodeURIComponent(actionElement.dataset.artist || "");
    const album = decodeURIComponent(actionElement.dataset.album || "");

    if (action === "view-artist") {
    openViewerDialog("artist", artist);
    } else if (action === "play-artist") {
    const fullDiscography = State.library.find(x => x.name === artist)?.albums.flatMap(al => al.tracks);
    if (fullDiscography?.length) executePlaybackQueue(fullDiscography, 0);
    } else if (action === "play-album") {
    const targetedAlbumInstance = findTargetAlbum(artist, album);
    if (targetedAlbumInstance) executePlaybackQueue(targetedAlbumInstance.tracks, 0);
    } else if (action === "play-track-row") {
    const targetedAlbumInstance = findTargetAlbum(artist, album);
    const trackingIndex = Number(actionElement.dataset.index);
    if (targetedAlbumInstance) executePlaybackQueue(targetedAlbumInstance.tracks, trackingIndex);
    }
});

// Control Elements Events Setup Hooks bindings interface
$("close-dialog").onclick = () => $("viewer-dialog").close();
$("search").oninput = event => renderLibraryGrid(event.target.value);

$("random").onclick = () => {
    const globalTracks = getFlattenedTracks();
    if (!globalTracks.length) return;
    const indexRand = Math.floor(Math.random() * globalTracks.length);
    executePlaybackQueue([globalTracks[indexRand]], 0);
};

$("current").onclick = () => {
    const activeTrack = State.queue[State.index];
    if (activeTrack) openViewerDialog("album", activeTrack.artist, activeTrack.album);
};

$("play-toggle").onclick = () => {
    initializeAudioGraph();
    if (audio.paused) {
    audio.play().catch(() => {});
    } else {
    audio.pause();
    }
};

$("next-track").onclick = () => shiftQueueIndex(1);
$("prev-track").onclick = () => shiftQueueIndex(-1);

$("seek-slider").onclick = event => {
    if (!audio.duration) return;
    const boundingDimensions = event.currentTarget.getBoundingClientRect();
    const relativeXCoordinate = event.clientX - boundingDimensions.left;
    audio.currentTime = (relativeXCoordinate / boundingDimensions.width) * audio.duration;
};

// System Audio Component Interception Event hooks bindings interface
audio.onplay = () => $("play-toggle").textContent = "Pause";
audio.onpause = () => $("play-toggle").textContent = "Play";
audio.onended = () => shiftQueueIndex(1);

audio.ontimeupdate = () => {
    const positionRatio = (audio.currentTime / audio.duration) * 100 || 0;
    $("fill-bar").style.width = `${positionRatio}%`;
    $("time-current").textContent = formatTime(audio.currentTime);
    if (audio.duration) $("time-total").textContent = formatTime(audio.duration);
};

// Native integration platforms hardware metadata bindings handles setups
if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => shiftQueueIndex(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => shiftQueueIndex(1));
}

/**
 * Canvas Graphics Visualization Procedural Matrix Module
 */
const canvas = $("visualizer");
const canvasContext = canvas.getContext("2d");

const synchronizeCanvasBoundingViewportDimensions = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
};
window.addEventListener("resize", synchronizeCanvasBoundingViewportDimensions, { passive: true });
synchronizeCanvasBoundingViewportDimensions();

function beginRenderAnimationLoop() {
    requestAnimationFrame(beginRenderAnimationLoop);
    if (!State.analyser) return;

    State.vTime += 0.016; // Incremental time frame ticker references

    const audioFrequencyDataBuffer = new Uint8Array(State.analyser.frequencyBinCount);
    State.analyser.getByteFrequencyData(audioFrequencyDataBuffer);
    
    canvasContext.clearRect(0, 0, canvas.width, canvas.height);

    const dynamicSampleIntervalStep = Math.max(1, Math.floor(audioFrequencyDataBuffer.length / 70));
    const calculationTotalBins = Math.ceil(audioFrequencyDataBuffer.length / dynamicSampleIntervalStep);
    const allocatedSlotWidth = canvas.width / calculationTotalBins;

    const bodyComputedStyle = getComputedStyle(document.body);
    const colorAccentHex = bodyComputedStyle.getPropertyValue("--accent").trim() || "#ffd86f";
    const colorDimHex = bodyComputedStyle.getPropertyValue("--text-dim").trim() || "#a0a0a0";

    canvasContext.textAlign = "center";
    canvasContext.textBaseline = "middle";
    canvasContext.font = "bold 26px 'Inter', system-ui, sans-serif";

    for (let index = 0, binIndex = 0; index < audioFrequencyDataBuffer.length; index += dynamicSampleIntervalStep, binIndex++) {
    const amplitudePercentage = audioFrequencyDataBuffer[index] / 255;
    const renderingXCoord = (binIndex * allocatedSlotWidth) + (allocatedSlotWidth / 2);
    const baseCalculatedYCoord = canvas.height - 60 - (amplitudePercentage * (canvas.height * 0.65));
    const finalWaveYCoord = baseCalculatedYCoord + Math.sin((State.vTime * 2) + (binIndex * 0.15)) * 12;
    const rotationalAngleRadians = ((State.vTime * 2.5) + (binIndex * 0.2) + (amplitudePercentage * 0.4)) % (Math.PI * 2);

    const fillGradient = canvasContext.createLinearGradient(renderingXCoord, finalWaveYCoord - 20, renderingXCoord, finalWaveYCoord + 20);
    fillGradient.addColorStop(0, colorAccentHex);
    fillGradient.addColorStop(1, colorDimHex);

    canvasContext.save();
    canvasContext.translate(renderingXCoord, finalWaveYCoord);
    canvasContext.rotate(rotationalAngleRadians);
    canvasContext.fillStyle = fillGradient;
    canvasContext.globalAlpha = 0.4 + (amplitudePercentage * 0.5);
    
    canvasContext.fillText("Σ", 0, 0);
    canvasContext.restore();
    }
    canvasContext.globalAlpha = 1.0;
}

/**
 * System Initialization Pipeline Asynchronous Node Launcher
 */
(async () => {
    try {
    const fetchStreamResponse = await fetch("music_data.json");
    if (!fetchStreamResponse.ok) throw new Error("Network status validation failure parsing file endpoint locations.");
    
    const runtimeRawEcosystemJSON = await fetchStreamResponse.json();

    State.library = Object.entries(runtimeRawEcosystemJSON).map(([artistName, artistData]) => ({
        name: artistName,
        img: artistData.location + `icon.png`,
        albums: (artistData.albums || []).map(albumItem => {
        const dynamicAlbumTitleString = albumItem.dname || albumItem.name || "Unknown Production Set Content";
        return {
            title: dynamicAlbumTitleString,
            cover: `${artistData.location}${albumItem.name}/cover.jpg`,
            tracks: (albumItem.tracks || []).map(trackObject => ({
            ...trackObject,
            artist: artistName,
            album: dynamicAlbumTitleString,
            file: artistData.location + trackObject.url,
            albumC: `${artistData.location}${albumItem.name}/cover.jpg`
            }))
        };
        })
    }));

    console.log("Loaded library:", State.library);

    State.fuse = new Fuse(getFlattenedTracks(), {
        keys: ["title", "artist", "album"],
        threshold: 0.35
    });

    renderLibraryGrid();
    $("status").textContent = `Loaded ${State.library.length} artists, ${getFlattenedAlbums().length} albums, and ${getFlattenedTracks().length} tracks.`;
    } catch (runtimeInitializationExceptionError) {
    console.error(runtimeInitializationExceptionError);
    $("status").textContent = "oh it broke";
    }
})();
})();