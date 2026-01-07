/**
 * DEGRE Player v2
 * Modern audio player for NowPlay integrated in Sauce4Zwift
 */

import * as common from '/pages/src/common.mjs';

// NowPlay base URL
const NOWPLAY_BASE = 'https://www.lucadegre.it/nowplay';
const NOWPLAY_API = `${NOWPLAY_BASE}/api`;

// Translations
const i18n = {
    en: {
        bannerText: 'ðŸŽµ Copyright-safe music for creators! This song of mine is royalty-free! A mention of song, artist & album would make me proud, but it\'s totally optional! Find and follow "Luca DEGRE" on Spotify, Apple Music, Amazon Music or your favorite streaming platform.',
        selectPlaylist: 'Select playlist...',
        loading: 'Loading...',
        unknownTrack: 'Unknown track',
        unknownAlbum: 'Unknown album',
        language: 'Language',
        visibility: 'Visibility',
        always: 'Always visible',
        racingOnly: 'Only during races',
    },
    it: {
        bannerText: 'ðŸŽµ Musica sicura per i creator! Questa mia canzone Ã¨ royalty-free! Una menzione di brano, artista e album mi renderebbe orgoglioso, ma Ã¨ del tutto opzionale! Trova e segui "Luca DEGRE" su Spotify, Apple Music, Amazon Music o la tua piattaforma preferita.',
        selectPlaylist: 'Seleziona playlist...',
        loading: 'Caricamento...',
        unknownTrack: 'Brano sconosciuto',
        unknownAlbum: 'Album sconosciuto',
        language: 'Lingua',
        visibility: 'VisibilitÃ ',
        always: 'Sempre visibile',
        racingOnly: 'Solo durante le gare',
    },
    fr: {
        bannerText: 'ðŸŽµ Musique libre de droits pour les crÃ©ateurs! Cette chanson est la mienne et elle est gratuite! Une mention de la chanson, de l\'artiste et de l\'album me rendrait fier, mais c\'est totalement optionnel! Trouvez et suivez "Luca DEGRE" sur Spotify, Apple Music, Amazon Music ou votre plateforme prÃ©fÃ©rÃ©e.',
        selectPlaylist: 'SÃ©lectionner playlist...',
        loading: 'Chargement...',
        unknownTrack: 'Piste inconnue',
        unknownAlbum: 'Album inconnu',
        language: 'Langue',
        visibility: 'VisibilitÃ©',
        always: 'Toujours visible',
        racingOnly: 'Pendant les courses',
    },
    es: {
        bannerText: 'ðŸŽµ Â¡MÃºsica segura para creadores! Â¡Esta canciÃ³n mÃ­a es libre de derechos! Â¡Una menciÃ³n de la canciÃ³n, artista y Ã¡lbum me harÃ­a sentir orgulloso, pero es totalmente opcional! Encuentra y sigue a "Luca DEGRE" en Spotify, Apple Music, Amazon Music o tu plataforma favorita.',
        selectPlaylist: 'Seleccionar playlist...',
        loading: 'Cargando...',
        unknownTrack: 'Pista desconocida',
        unknownAlbum: 'Ãlbum desconocido',
        language: 'Idioma',
        visibility: 'Visibilidad',
        always: 'Siempre visible',
        racingOnly: 'Solo durante carreras',
    }
};

function t(key) {
    const lang = common.settingsStore.get('language') || 'en';
    return i18n[lang]?.[key] || i18n.en[key] || key;
}

// Default settings
common.settingsStore.setDefault({
    language: 'en',
    hideWhen: 'never',
    autoplay: 'none',
    playlistSlug: 'zwift-time',
    volume: 0.7,
    shuffle: true
});

// State
const state = {
    playlist: null,
    playlists: [],
    tracks: [],
    currentIndex: 0,
    isPlaying: false,
    audio: null,
    playStartTime: null,
    playTracked: false,
    isInRace: false,
    tracksLoaded: 0,
    bannerTimeout: null,
    currentSpeed: 0,
    currentPower: 0
};

// DOM Elements
let elements = {};

// === API FUNCTIONS ===

async function fetchPlaylists() {
    try {
        const response = await fetch(`${NOWPLAY_API}/playlists.php`);
        const data = await response.json();
        if (data.success) {
            state.playlists = data.data;
            return data.data;
        }
    } catch (error) {
        console.error('[Player] Error loading playlists:', error);
    }
    return [];
}

async function fetchPlaylistTracks(slug) {
    if (!slug) return false;
    
    try {
        elements.container.classList.add('loading');
        const response = await fetch(`${NOWPLAY_API}/playlists.php?slug=${slug}`);
        const data = await response.json();
        
        if (data.success) {
            state.playlist = data.data.playlist;
            state.tracks = data.data.tracks;
            state.currentIndex = 0;
            
            const settings = common.settingsStore.get();
            if (settings.shuffle && state.tracks.length > 1) {
                shuffleTracks();
            }
            
            elements.container.classList.remove('loading');
            return true;
        }
    } catch (error) {
        console.error('[Player] Error loading tracks:', error);
    }
    
    elements.container.classList.remove('loading');
    return false;
}

async function trackPlay(trackId) {
    if (!trackId || state.playTracked) return;
    
    try {
        await fetch(`${NOWPLAY_API}/play.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_id: trackId })
        });
        state.playTracked = true;
        console.log('[Player] Play tracked for track:', trackId);
    } catch (error) {
        console.error('[Player] Error tracking play:', error);
    }
}

// === PLAYER FUNCTIONS ===

function shuffleTracks() {
    for (let i = state.tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.tracks[i], state.tracks[j]] = [state.tracks[j], state.tracks[i]];
    }
}

function loadTrack(index) {
    if (index < 0 || index >= state.tracks.length) return;
    
    const track = state.tracks[index];
    state.currentIndex = index;
    state.playStartTime = null;
    state.playTracked = false;
    
    // Track counter for banner visibility
    state.tracksLoaded++;
    
    // Show banner from second track onwards, for one loop (25s)
    if (state.tracksLoaded > 1 && elements.topBar) {
        // Clear any existing timeout
        if (state.bannerTimeout) {
            clearTimeout(state.bannerTimeout);
        }
        
        // Show banner
        elements.topBar.classList.remove('hidden');
        
        // Hide after one animation loop (25s)
        state.bannerTimeout = setTimeout(() => {
            elements.topBar.classList.add('hidden');
        }, 25000);
    }
    
    // Update cover
    elements.cover.style.backgroundImage = `url('${track.cover_url}')`;
    
    // Update bottom bar info
    const title = track.title || t('unknownTrack');
    const album = track.album_name || t('unknownAlbum');
    elements.trackTitle.textContent = title;
    elements.trackAlbum.textContent = album;
    
    // Check if scrolling is needed
    checkScrollNeeded();
    
    // Load audio
    state.audio.src = track.audio_url;
    state.audio.load();
}

function checkScrollNeeded() {
    requestAnimationFrame(() => {
        const container = elements.trackInfo;
        const inner = elements.trackInfoInner;
        
        if (inner.scrollWidth > container.clientWidth) {
            container.classList.add('needs-scroll');
            const title = elements.trackTitle.textContent;
            const album = elements.trackAlbum.textContent;
            inner.innerHTML = `
                <span class="track-title">${title}</span>
                <span class="track-separator">â€¢</span>
                <span class="track-album">${album}</span>
                <span class="track-separator" style="margin: 0 30px;"></span>
                <span class="track-title">${title}</span>
                <span class="track-separator">â€¢</span>
                <span class="track-album">${album}</span>
            `;
        } else {
            container.classList.remove('needs-scroll');
        }
    });
}

function updateBannerText() {
    const text = t('bannerText');
    // Duplicate for seamless loop
    elements.topText.textContent = text + '          ' + text;
}

function togglePlay() {
    if (state.tracks.length === 0) {
        const settings = common.settingsStore.get();
        if (settings.playlistSlug) {
            fetchPlaylistTracks(settings.playlistSlug).then(success => {
                if (success && state.tracks.length > 0) {
                    loadTrack(0);
                    state.audio.play();
                }
            });
        }
        return;
    }
    
    if (state.isPlaying) {
        state.audio.pause();
    } else {
        state.audio.play();
    }
}

function playNext() {
    if (state.tracks.length === 0) return;
    
    let nextIndex = state.currentIndex + 1;
    if (nextIndex >= state.tracks.length) {
        nextIndex = 0;
    }
    
    loadTrack(nextIndex);
    if (state.isPlaying) {
        state.audio.play();
    }
}

function setVolume(value) {
    state.audio.volume = value;
    common.settingsStore.set('volume', value);
    
    const percent = value * 100;
    elements.volumeTrack.style.setProperty('--volume-percent', `${percent}%`);
}

function openInNowPlay() {
    const track = state.tracks[state.currentIndex];
    if (track && track.id) {
        window.open(`${NOWPLAY_BASE}/?track=${track.id}`, '_blank');
    }
}

// === EVENT HANDLERS ===

function onPlay() {
    state.isPlaying = true;
    state.playStartTime = Date.now();
    elements.btnPlay.innerHTML = getIconPause();
    elements.container.classList.add('playing');
}

function onPause() {
    state.isPlaying = false;
    elements.btnPlay.innerHTML = getIconPlay();
    elements.container.classList.remove('playing');
}

function onTimeUpdate() {
    if (state.playStartTime && !state.playTracked) {
        const elapsed = (Date.now() - state.playStartTime) / 1000;
        if (elapsed >= 10) {
            const track = state.tracks[state.currentIndex];
            if (track) {
                trackPlay(track.id);
            }
        }
    }
}

function onEnded() {
    playNext();
    if (state.tracks.length > 0) {
        state.audio.play();
    }
}

function onPlaylistChange(e) {
    const slug = e.target.value;
    if (!slug) return;
    
    common.settingsStore.set('playlistSlug', slug);
    fetchPlaylistTracks(slug).then(success => {
        if (success && state.tracks.length > 0) {
            loadTrack(0);
        }
    });
}

// === VISIBILITY ===

function updateVisibility() {
    const settings = common.settingsStore.get();
    const hideWhen = settings.hideWhen || 'never';
    
    let shouldHide = false;
    
    if (hideWhen === 'speed0' && state.currentSpeed === 0) {
        shouldHide = true;
    } else if (hideWhen === 'watts0' && state.currentPower === 0) {
        shouldHide = true;
    }
    
    elements.container.classList.toggle('hidden-by-setting', shouldHide);
}

// === ICONS ===

function getIconPlay() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
}

function getIconPause() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
}

function getIconNext() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`;
}

function getIconExternal() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>`;
}

function getIconVolumeLow() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 9v6h4l5 5V4l-5 5H7z"/></svg>`;
}

function getIconVolumeHigh() {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
}

// === DOM INITIALIZATION ===

function initDOM() {
    const content = document.getElementById('content');
    
    // Main container
    elements.container = document.createElement('div');
    elements.container.className = 'player-container';
    
    // Cover (background)
    elements.cover = document.createElement('div');
    elements.cover.className = 'player-cover';
    
    // Top bar (copyright banner)
    elements.topBar = document.createElement('div');
    elements.topBar.className = 'player-top-bar hidden';
    
    elements.topText = document.createElement('div');
    elements.topText.className = 'player-top-text';
    
    elements.topBar.appendChild(elements.topText);
    
    // Controls (center, hidden by default)
    elements.controls = document.createElement('div');
    elements.controls.className = 'player-controls';
    
    elements.btnPlay = document.createElement('button');
    elements.btnPlay.className = 'player-btn btn-play';
    elements.btnPlay.innerHTML = getIconPlay();
    elements.btnPlay.addEventListener('click', togglePlay);
    
    elements.btnNext = document.createElement('button');
    elements.btnNext.className = 'player-btn btn-next';
    elements.btnNext.innerHTML = getIconNext();
    elements.btnNext.addEventListener('click', playNext);
    
    elements.btnExternal = document.createElement('button');
    elements.btnExternal.className = 'player-btn btn-external';
    elements.btnExternal.innerHTML = getIconExternal();
    elements.btnExternal.addEventListener('click', openInNowPlay);
    
    elements.controls.appendChild(elements.btnPlay);
    elements.controls.appendChild(elements.btnNext);
    elements.controls.appendChild(elements.btnExternal);
    
    // Volume (above bottom bar, hidden by default)
    elements.volumeContainer = document.createElement('div');
    elements.volumeContainer.className = 'player-volume';
    
    elements.volumeLow = document.createElement('span');
    elements.volumeLow.className = 'volume-icon';
    elements.volumeLow.innerHTML = getIconVolumeLow();
    
    elements.volumeTrack = document.createElement('div');
    elements.volumeTrack.className = 'volume-track';
    
    elements.volumeSlider = document.createElement('input');
    elements.volumeSlider.type = 'range';
    elements.volumeSlider.min = '0';
    elements.volumeSlider.max = '100';
    elements.volumeSlider.value = '70';
    elements.volumeSlider.addEventListener('input', (e) => setVolume(e.target.value / 100));
    
    elements.volumeHigh = document.createElement('span');
    elements.volumeHigh.className = 'volume-icon';
    elements.volumeHigh.innerHTML = getIconVolumeHigh();
    
    elements.volumeTrack.appendChild(elements.volumeSlider);
    elements.volumeContainer.appendChild(elements.volumeLow);
    elements.volumeContainer.appendChild(elements.volumeTrack);
    elements.volumeContainer.appendChild(elements.volumeHigh);
    
    // Bottom bar (track info)
    elements.bottomBar = document.createElement('div');
    elements.bottomBar.className = 'player-bottom-bar';
    
    elements.trackInfo = document.createElement('div');
    elements.trackInfo.className = 'player-track-info';
    
    elements.trackInfoInner = document.createElement('div');
    elements.trackInfoInner.className = 'player-track-info-inner';
    
    elements.trackTitle = document.createElement('span');
    elements.trackTitle.className = 'track-title';
    elements.trackTitle.textContent = 'DEGRE Player';
    
    elements.trackSeparator = document.createElement('span');
    elements.trackSeparator.className = 'track-separator';
    elements.trackSeparator.textContent = 'â€¢';
    
    elements.trackAlbum = document.createElement('span');
    elements.trackAlbum.className = 'track-album';
    elements.trackAlbum.textContent = t('selectPlaylist');
    
    elements.trackInfoInner.appendChild(elements.trackTitle);
    elements.trackInfoInner.appendChild(elements.trackSeparator);
    elements.trackInfoInner.appendChild(elements.trackAlbum);
    elements.trackInfo.appendChild(elements.trackInfoInner);
    
    // Playlist overlay (appears on hover of bottom bar)
    elements.playlistOverlay = document.createElement('div');
    elements.playlistOverlay.className = 'player-playlist-overlay';
    
    elements.playlistSelect = document.createElement('select');
    elements.playlistSelect.className = 'playlist-select';
    elements.playlistSelect.innerHTML = `<option value="">${t('selectPlaylist')}</option>`;
    elements.playlistSelect.addEventListener('change', onPlaylistChange);
    
    elements.playlistOverlay.appendChild(elements.playlistSelect);
    
    // Assemble bottom bar
    elements.bottomBar.appendChild(elements.trackInfo);
    elements.bottomBar.appendChild(elements.playlistOverlay);
    
    // Assemble container
    elements.container.appendChild(elements.cover);
    elements.container.appendChild(elements.topBar);
    elements.container.appendChild(elements.controls);
    elements.container.appendChild(elements.volumeContainer);
    elements.container.appendChild(elements.bottomBar);
    
    content.appendChild(elements.container);
    
    // Audio element
    state.audio = new Audio();
    state.audio.preload = 'none'; // Don't preload entire file, stream progressively
    state.audio.addEventListener('play', onPlay);
    state.audio.addEventListener('pause', onPause);
    state.audio.addEventListener('ended', onEnded);
    state.audio.addEventListener('timeupdate', onTimeUpdate);
    state.audio.addEventListener('error', () => {
        console.error('[Player] Audio error');
    });
}

async function populatePlaylistSelector() {
    const playlists = await fetchPlaylists();
    const settings = common.settingsStore.get();
    
    elements.playlistSelect.innerHTML = playlists.map(p => 
        `<option value="${p.slug}" ${p.slug === settings.playlistSlug ? 'selected' : ''}>${p.nome}</option>`
    ).join('');
    
    // Load saved playlist
    if (settings.playlistSlug) {
        const success = await fetchPlaylistTracks(settings.playlistSlug);
        if (success && state.tracks.length > 0) {
            loadTrack(0);
        }
    }
}

// === MAIN ===

export async function main() {
    common.initInteractionListeners();
    
    initDOM();
    
    // Apply initial visibility (hidden if setting requires it and speed/power are 0)
    updateVisibility();
    
    // Set banner text
    updateBannerText();
    
    const settings = common.settingsStore.get();
    setVolume(settings.volume);
    
    await populatePlaylistSelector();
    
    // Autoplay immediate: timer 3 sec dopo caricamento
    if (settings.autoplay === 'immediate') {
        setTimeout(() => {
            if (state.tracks.length > 0 && !state.isPlaying) {
                togglePlay();
            }
        }, 3000);
    }
    
    common.subscribe('athlete/watching', watching => {
        if (!watching?.state) return;
        
        const eventPosition = watching.state.eventPosition || watching.eventPosition || 0;
        const wasInRace = state.isInRace;
        state.isInRace = eventPosition > 0;
        
        // Track speed and power for visibility
        state.currentSpeed = watching.state.speed || 0;
        state.currentPower = watching.state.power || 0;
        
        // Autoplay on event start
        const currentSettings = common.settingsStore.get();
        if (currentSettings.autoplay === 'on_event_start' && !wasInRace && state.isInRace) {
            if (state.tracks.length > 0 && !state.isPlaying) {
                togglePlay();
            }
        }
        
        updateVisibility();
    });
    
    common.settingsStore.addEventListener('changed', ev => {
        const changed = ev.data.changed;
        
        if (changed.has('playlistSlug')) {
            const newSlug = changed.get('playlistSlug');
            fetchPlaylistTracks(newSlug).then(success => {
                if (success && state.tracks.length > 0) {
                    loadTrack(0);
                }
            });
        }
        
        if (changed.has('language')) {
            updateBannerText();
        }
        
        updateVisibility();
    });
    
    window.addEventListener('resize', () => {
        if (state.tracks.length > 0) {
            checkScrollNeeded();
        }
    });
    
    console.log('[Player v2] Initialized');
}

export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#options')();
}
