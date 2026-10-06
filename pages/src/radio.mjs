/**
 * DEGRE Radio v1.1
 * Native Sauce4Zwift widget for the NowPlay web radio: synced stream (same
 * clock as www.lucadegre.it/nowplay/radio and the Discord bot), stations,
 * thumbs, listener requests. No iframe: it talks to the radio API directly.
 *
 * Two windows:
 *  - radio.html       the compact "now playing" bar (this file: main())
 *  - radio-panel.html stations / votes / requests, opened as a child window
 *                     from the bar's arrow button (panelMain()). It shares
 *                     the settings store with the bar: changing the station
 *                     there retunes the bar through the 'changed' event.
 *
 * How the sync works (same model as the web player):
 *  - api.php?action=now tells which track is on air and at which second;
 *    we load the file, seek to that offset and play.
 *  - 20 s before the end we preload next_track (a hidden Audio warms the
 *    cache); when the current file ends we swap to it at 0 immediately,
 *    then ask the server again in the background to true-up metadata.
 *  - A poll every 10 s catches station changes, DJ overrides and listener
 *    requests (which the server announces as next_track).
 *  - While playing, each poll carries an anonymous listener token (lid) and
 *    src=sauce so the listener shows up in the radio stats as "Sauce".
 */

import * as common from '/pages/src/common.mjs';

const BASE = 'https://www.lucadegre.it';
const RADIO_API = `${BASE}/nowplay/radio/api.php`;
const LID_KEY = 'degre-radio-lid';
const SOURCE = 'sauce';

const POLL_MS = 10000;
const PRELOAD_LEAD_S = 20;
const NEW_TRACK_THRESHOLD_MS = 6000;  // started less than this ago -> play from 0
const END_SWITCH_GUARD_S = 8;         // server changed track while we are about to end -> let it end
const SWAP_GRACE_MS = 15000;          // server still on the track we just closed -> ignore

common.settingsStore.setDefault({
    channel: 'zwift-time',
    autoplay: 'none',          // none | immediate | on_event_start
    hideWhen: 'never',         // never | speed0 | watts0
    volume: 0.7,
    requesterName: '',
    opacity: 1,
});

// Anonymous listener token (hex, 32 chars), same mechanism as the web player
let listenerId = localStorage.getItem(LID_KEY) || '';
if (!/^[a-f0-9]{16,64}$/.test(listenerId)) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    listenerId = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(LID_KEY, listenerId);
}

// =====================================================
// SHARED HELPERS (bar + panel)
// =====================================================

function channelParam() {
    const ch = common.settingsStore.get('channel');
    return ch ? `&channel=${encodeURIComponent(ch)}` : '';
}

function absUrl(path) {
    return path.startsWith('http') ? path : BASE + path;
}

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function icon(name) {
    const paths = {
        play: 'M8 5v14l11-7z',
        stop: 'M6 6h12v12H6z',
        volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
        more: 'M10 17l5-5-5-5v10z',
        mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
        up: 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
        down: 'M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z',
        external: 'M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    };
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${paths[name]}"/></svg>`;
}

function button(cls, name, title) {
    const b = document.createElement('button');
    b.className = `ibtn ${cls}`;
    b.title = title;
    b.innerHTML = icon(name);
    return b;
}

async function apiNow(withHeartbeat) {
    const lid = withHeartbeat ? `&lid=${listenerId}&src=${SOURCE}` : '';
    const res = await fetch(`${RADIO_API}?action=now${channelParam()}${lid}&_t=${Date.now()}`);
    const data = await res.json();
    if (!data.success) {
        throw new Error(data.error || 'API error');
    }
    return data;
}

async function apiChannels() {
    try {
        const res = await fetch(`${RADIO_API}?action=channels`);
        const data = await res.json();
        if (data.success && Array.isArray(data.channels)) {
            return data.channels;
        }
    } catch (e) {
        console.error('[Radio] channels failed:', e);
    }
    return [];
}

function stationName(channels, slug) {
    const ch = channels.find(c => (c.slug || '') === (slug || ''));
    return ch ? ch.name : (slug || 'All Songs');
}

/** "Up next … requested by …" line from a 'now' payload */
function requestLine(data) {
    if (data.track && data.track.requested_by) {
        return 'Requested by ' + data.track.requested_by;
    }
    const q = data.requests && data.requests.queue ? data.requests.queue : [];
    if (data.next_track && data.next_track.requested_by != null) {
        return 'Up next: ' + data.next_track.title + ' · requested by ' + data.next_track.requested_by;
    }
    if (data.next_track && q.length && q[0].track_id === data.next_track.id) {
        return 'Up next: ' + data.next_track.title + ' · by request';
    }
    return '';
}

// =====================================================
// BAR WINDOW
// =====================================================

const state = {
    isPlaying: false,
    wantPlaying: false,
    currentTrack: null,
    nextTrack: null,
    preload: null,          // { trackId, audio }
    swappedFrom: null,      // { id, at }
    isOverride: false,
    channels: [],
    pollTimer: null,
    isInRace: false,
    currentSpeed: 0,
    currentPower: 0,
    playRegistered: false,
};

const el = {};
let audio;

async function registerPlay(trackId) {
    try {
        await fetch(`${BASE}/nowplay/api/play.php`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({track_id: trackId, source: 'radio'}),
        });
    } catch (e) {
        console.error('[Radio] play register failed:', e);
    }
}

function waitCanPlay(a) {
    return new Promise((resolve, reject) => {
        const ok = () => { cleanup(); resolve(); };
        const ko = e => { cleanup(); reject(e); };
        const cleanup = () => {
            a.removeEventListener('canplay', ok);
            a.removeEventListener('error', ko);
        };
        a.addEventListener('canplay', ok);
        a.addEventListener('error', ko);
        a.load();
    });
}

function clearPreload() {
    if (state.preload && state.preload.audio) {
        state.preload.audio.removeAttribute('src');
    }
    state.preload = null;
}

function maybePreloadNext() {
    if (!state.isPlaying || !state.nextTrack || !state.nextTrack.audio_url) return;
    if (state.preload && state.preload.trackId === state.nextTrack.id) return;
    const remaining = audio.duration - audio.currentTime;
    if (!isFinite(remaining) || remaining > PRELOAD_LEAD_S) return;
    clearPreload();
    const warm = new Audio();
    warm.preload = 'auto';
    warm.src = absUrl(state.nextTrack.audio_url);
    warm.load();
    state.preload = {trackId: state.nextTrack.id, audio: warm};
}

async function loadAndPlay(track, offsetMs) {
    audio.src = absUrl(track.audio_url);
    await waitCanPlay(audio);
    audio.currentTime = (offsetMs < NEW_TRACK_THRESHOLD_MS ? 0 : offsetMs) / 1000;
    if (state.wantPlaying) {
        await audio.play();
    }
}

/** Poll: detect track changes (schedule, override, requests) and resync. */
async function syncPlayer(refreshMeta = false) {
    let data;
    try {
        data = await apiNow(state.isPlaying);
    } catch (e) {
        console.error('[Radio] sync failed:', e);
        el.station.textContent = 'Radio unreachable';
        return;
    }
    state.isOverride = !!data.is_override;
    updateListeners(data.listeners);
    el.nextreq.textContent = requestLine(data);

    const changed = !state.currentTrack || state.currentTrack.id !== data.track.id;

    // Grace after a gapless swap: the server may lag a fraction of a second
    if (changed && !data.is_override && state.swappedFrom &&
        data.track.id === state.swappedFrom.id && Date.now() - state.swappedFrom.at < SWAP_GRACE_MS) {
        if (refreshMeta) setTimeout(() => syncPlayer(true), 2500);
        return;
    }
    state.swappedFrom = null;

    // About to end naturally: do not cut the tail, the swap handles it
    if (changed && state.currentTrack && state.isPlaying && !data.is_override && !audio.paused && !audio.ended) {
        const remaining = audio.duration - audio.currentTime;
        if (isFinite(remaining) && remaining > 0 && remaining < END_SWITCH_GUARD_S) {
            state.nextTrack = data.track;
            return;
        }
    }
    state.nextTrack = data.next_track || null;

    if (changed) {
        clearPreload();
        state.currentTrack = data.track;
        state.playRegistered = false;
        updateTrackInfo(data.track);
        if (state.wantPlaying) {
            try {
                await loadAndPlay(data.track, data.offset_ms);
            } catch (e) {
                console.error('[Radio] load failed:', e);
            }
        }
    } else if (refreshMeta) {
        state.currentTrack = data.track;
        updateTrackInfo(data.track);
    }
}

async function onEnded() {
    const next = state.nextTrack;
    if (next && next.audio_url && !state.isOverride && state.wantPlaying) {
        state.swappedFrom = {id: state.currentTrack ? state.currentTrack.id : null, at: Date.now()};
        state.currentTrack = next;
        state.nextTrack = null;
        state.playRegistered = false;
        clearPreload();
        updateTrackInfo(next);
        audio.src = absUrl(next.audio_url);
        try {
            await audio.play();
        } catch (e) {
            console.error('[Radio] swap failed:', e);
            syncPlayer();
            return;
        }
        setTimeout(() => syncPlayer(true), 1500);
        return;
    }
    // No preloaded next: ask the server until it moves on
    const endedId = state.currentTrack ? state.currentTrack.id : null;
    for (let i = 0; i < 6; i++) {
        await syncPlayer();
        if (!state.currentTrack || state.currentTrack.id !== endedId) return;
        await new Promise(r => setTimeout(r, 1000));
    }
}

async function play() {
    state.wantPlaying = true;
    el.station.textContent = 'Syncing…';
    try {
        const data = await apiNow(false);
        state.isOverride = !!data.is_override;
        state.nextTrack = data.next_track || null;
        updateListeners(data.listeners);
        el.nextreq.textContent = requestLine(data);
        const isNew = !state.currentTrack || state.currentTrack.id !== data.track.id;
        if (isNew) {
            state.currentTrack = data.track;
            state.playRegistered = false;
            updateTrackInfo(data.track);
            audio.src = absUrl(data.track.audio_url);
            await waitCanPlay(audio);
        } else if (!audio.src) {
            audio.src = absUrl(data.track.audio_url);
            await waitCanPlay(audio);
        }
        // A radio: always resync to the live position when (re)starting
        audio.currentTime = data.offset_ms / 1000;
        await audio.play();
        startPolling();
    } catch (e) {
        console.error('[Radio] play failed:', e);
        el.station.textContent = 'Radio unreachable';
        state.wantPlaying = false;
        updatePlayButton();
    }
}

function stop() {
    state.wantPlaying = false;
    audio.pause();
    stopPolling();
    clearPreload();
    updatePlayButton();
    updateStationLabel();
}

function togglePlay() {
    if (state.isPlaying) stop(); else play();
}

function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => syncPlayer(), POLL_MS);
}

function stopPolling() {
    if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }
}

function onTimeUpdate() {
    maybePreloadNext();
    if (!state.playRegistered && state.currentTrack && audio.currentTime > 10) {
        state.playRegistered = true;
        registerPlay(state.currentTrack.id);
    }
}

function buildBar() {
    const content = document.getElementById('content');
    el.root = document.createElement('div');
    el.root.className = 'radio';

    el.bar = document.createElement('div');
    el.bar.className = 'bar';
    el.cover = document.createElement('div');
    el.cover.className = 'cover';
    el.cover.title = 'Open in NowPlay';
    el.cover.addEventListener('click', () => {
        const t = state.currentTrack;
        window.open(t && t.album_slug ? `${BASE}/nowplay/album/${t.album_slug}` : `${BASE}/nowplay/radio/`, '_blank');
    });

    el.info = document.createElement('div');
    el.info.className = 'info';
    el.info.innerHTML = `
        <div class="line"><span class="live">RADIO</span><span class="station"></span><span class="listeners"></span></div>
        <div class="title">NowPlay radio</div>
        <div class="artist">Press play to tune in</div>
        <div class="nextreq"></div>`;
    el.live = el.info.querySelector('.live');
    el.station = el.info.querySelector('.station');
    el.listeners = el.info.querySelector('.listeners');
    el.title = el.info.querySelector('.title');
    el.artist = el.info.querySelector('.artist');
    el.nextreq = el.info.querySelector('.nextreq');

    el.controls = document.createElement('div');
    el.controls.className = 'controls';
    el.vol = document.createElement('div');
    el.vol.className = 'vol';
    el.volBtn = button('volbtn', 'volume', 'Volume');
    el.volSlider = document.createElement('input');
    el.volSlider.type = 'range';
    el.volSlider.min = '0';
    el.volSlider.max = '100';
    el.volSlider.addEventListener('input', () => setVolume(el.volSlider.value / 100));
    el.vol.appendChild(el.volSlider);
    el.vol.appendChild(el.volBtn);
    el.play = button('play', 'play', 'Play / stop');
    el.play.addEventListener('click', togglePlay);
    // Panel opens as a Sauce child window (same mechanism as the settings gear)
    el.more = document.createElement('a');
    el.more.className = 'ibtn more open-settings';
    el.more.title = 'Stations, votes, requests';
    el.more.href = './radio-panel.html?width=380&height=520&child-window';
    el.more.target = 'degre-radio-panel';
    el.more.innerHTML = icon('more');
    el.controls.appendChild(el.vol);
    el.controls.appendChild(el.play);
    el.controls.appendChild(el.more);

    el.bar.appendChild(el.cover);
    el.bar.appendChild(el.info);
    el.bar.appendChild(el.controls);
    el.root.appendChild(el.bar);
    content.appendChild(el.root);

    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('play', () => { state.isPlaying = true; updatePlayButton(); updateStationLabel(); });
    audio.addEventListener('pause', () => { state.isPlaying = false; updatePlayButton(); updateStationLabel(); });
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', () => console.error('[Radio] audio error'));
}

function updatePlayButton() {
    el.play.innerHTML = icon(state.isPlaying ? 'stop' : 'play');
    el.root.classList.toggle('playing', state.isPlaying);
}

function updateStationLabel() {
    el.station.textContent = stationName(state.channels, common.settingsStore.get('channel')) + (state.isPlaying ? '' : ' · stopped');
}

function updateListeners(counts) {
    if (!counts) { el.listeners.textContent = ''; return; }
    el.listeners.textContent = `🎧 ${counts.channel}`;
    el.listeners.title = `${counts.channel} listening on this station · ${counts.total} on the whole radio`;
}

function updateTrackInfo(track) {
    el.title.textContent = track.title || 'Unknown';
    el.artist.textContent = (track.artist || '') + (track.album ? ' · ' + track.album : '');
    el.cover.style.backgroundImage = track.cover_url ? `url('${absUrl(track.cover_url)}')` : '';
    updateStationLabel();
}

function setVolume(v) {
    audio.volume = v;
    el.volSlider.value = Math.round(v * 100);
    common.settingsStore.set('volume', v);
}

function updateVisibility() {
    const s = common.settingsStore.get();
    let hide = false;
    if (s.hideWhen === 'speed0' && state.currentSpeed === 0) hide = true;
    else if (s.hideWhen === 'watts0' && state.currentPower === 0) hide = true;
    el.root.classList.toggle('hidden-by-setting', hide);
    el.root.style.opacity = hide ? '' : (s.opacity ?? 1);
}

export async function main() {
    common.initInteractionListeners();
    buildBar();
    const settings = common.settingsStore.get();
    setVolume(settings.volume ?? 0.7);
    updatePlayButton();
    updateVisibility();

    state.channels = await apiChannels();
    updateStationLabel();
    // Show what is on air even before pressing play
    syncPlayer(true);

    if (settings.autoplay === 'immediate') {
        setTimeout(() => { if (!state.isPlaying) play(); }, 2000);
    }

    common.subscribe('athlete/watching', watching => {
        if (!watching?.state) return;
        const eventPosition = watching.state.eventPosition || watching.eventPosition || 0;
        const wasInRace = state.isInRace;
        state.isInRace = eventPosition > 0;
        state.currentSpeed = watching.state.speed || 0;
        state.currentPower = watching.state.power || 0;
        const s = common.settingsStore.get();
        if (s.autoplay === 'on_event_start' && !wasInRace && state.isInRace && !state.isPlaying) {
            play();
        }
        updateVisibility();
    });

    common.settingsStore.addEventListener('changed', ev => {
        const changed = ev.data.changed;
        if (changed.has('channel')) {
            state.currentTrack = null;
            state.nextTrack = null;
            clearPreload();
            if (state.wantPlaying) play(); else syncPlayer(true);
        }
        if (changed.has('volume') && audio) {
            audio.volume = changed.get('volume');
            el.volSlider.value = Math.round(changed.get('volume') * 100);
        }
        updateVisibility();
    });

    // Keep the "now playing" line fresh while stopped (light poll, no audio)
    setInterval(() => { if (!state.isPlaying) syncPlayer(true); }, 30000);

    console.log('[Radio v1.1] Initialized');
}

// =====================================================
// PANEL WINDOW (stations, votes, requests)
// =====================================================

const panel = {
    channels: [],
    now: null,
    requests: null,
    searchTimer: null,
    lastQuery: '',
    votedTrackId: null,
    el: {},
};

async function panelRefresh() {
    try {
        const data = await apiNow(false);
        panel.now = data;
        panel.requests = data.requests || null;
        const t = data.track;
        panel.el.nowTitle.textContent = t.title || '—';
        panel.el.nowArtist.textContent = (t.artist || '') + (t.album ? ' · ' + t.album : '');
        panel.el.nowCover.style.backgroundImage = t.cover_url ? `url('${absUrl(t.cover_url)}')` : '';
        panel.el.nowLine.textContent = requestLine(data);
        panel.el.voteUp.classList.toggle('voted', panel.votedTrackId === t.id);
        if (panel.votedTrackId !== t.id) panel.el.voteDown.classList.remove('voted');
        panelRenderQueue();
        if (panel.requests && panel.requests.enabled === false) {
            panelStatus('Requests are off on this station right now.', true);
        } else if (panel.requests && panel.requests.cooldown_s > 0 && !panel.el.status.textContent.startsWith('🎙️')) {
            panelStatus('⏳ You can request another track in ' + (panel.requests.cooldown_s >= 90 ? Math.ceil(panel.requests.cooldown_s / 60) + ' min' : panel.requests.cooldown_s + ' s') + '.');
        }
    } catch (e) {
        console.error('[Radio panel] refresh failed:', e);
    }
}

function panelRenderChips() {
    const current = common.settingsStore.get('channel') || '';
    panel.el.chips.innerHTML = '';
    for (const ch of panel.channels) {
        const slug = ch.slug || '';
        const b = document.createElement('button');
        b.className = 'chip' + (slug === current ? ' active' : '');
        b.textContent = ch.name;
        b.addEventListener('click', () => {
            common.settingsStore.set('channel', slug);   // the bar retunes on 'changed'
            panelRenderChips();
            panel.now = null;
            panelRefresh();
        });
        panel.el.chips.appendChild(b);
    }
}

function panelRenderQueue() {
    const q = panel.requests && panel.requests.queue ? panel.requests.queue : [];
    if (!q.length) {
        panel.el.queue.innerHTML = '<span class="muted">No requests yet. Yours could be the first!</span>';
        return;
    }
    panel.el.queue.innerHTML = q.map(r => `
        <div class="reqitem"><span class="rpos">${r.position}</span>
            <img src="${escapeHtml(absUrl(r.cover_url || '/nowplay/covers/default.png'))}" alt="">
            <div class="rt"><b>${escapeHtml(r.title)}</b><small>${escapeHtml(r.artist || '')}${r.requested_by ? ' · requested by ' + escapeHtml(r.requested_by) : ''}${r.via_discord ? ' · via Discord' : ''}</small></div>
        </div>`).join('');
}

function panelStatus(msg, isErr) {
    panel.el.status.textContent = msg || '';
    panel.el.status.classList.toggle('err', !!isErr);
}

function panelFeedback(msg) {
    panel.el.feedback.textContent = msg;
    setTimeout(() => { panel.el.feedback.textContent = ''; }, 2500);
}

async function panelVote(vote) {
    const id = panel.now && panel.now.track && panel.now.track.id;
    if (!id) return;
    try {
        const res = await fetch(`${BASE}/nowplay/api/vote.php`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({track_id: id, vote}),
        });
        const data = await res.json();
        panelFeedback(data.success ? (vote === 8 ? '👍 Thanks!' : '👎 Noted!') : (data.message || 'Vote error'));
        if (data.success) {
            panel.votedTrackId = id;
            panel.el.voteUp.classList.toggle('voted', vote === 8);
            panel.el.voteDown.classList.toggle('voted', vote !== 8);
        }
    } catch (e) {
        panelFeedback('Vote error');
    }
}

function panelSearchInput() {
    const q = panel.el.search.value.trim();
    clearTimeout(panel.searchTimer);
    if (q.length < 2) { panel.el.results.innerHTML = ''; panel.lastQuery = ''; return; }
    panel.searchTimer = setTimeout(() => panelSearch(q), 300);
}

async function panelSearch(q) {
    if (q === panel.lastQuery) return;
    panel.lastQuery = q;
    try {
        const res = await fetch(`${RADIO_API}?action=request_search${channelParam()}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (panel.el.search.value.trim() !== q) return;
        const tracks = (data && data.tracks) || [];
        if (!tracks.length) {
            panel.el.results.innerHTML = `<span class="muted">Nothing on this station matches "${escapeHtml(q)}".</span>`;
            return;
        }
        panel.el.results.innerHTML = tracks.map(t => `
            <div class="reqitem">
                <img src="${escapeHtml(absUrl(t.cover_url || '/nowplay/covers/default.png'))}" alt="">
                <div class="rt"><b>${escapeHtml(t.title)}</b><small>${escapeHtml(t.artist || '')}${t.album ? ' · ' + escapeHtml(t.album) : ''}</small></div>
                <button class="rbtn" data-id="${t.id}" ${t.already_queued ? 'disabled' : ''}>${t.already_queued ? 'Queued' : 'Request'}</button>
            </div>`).join('');
    } catch (e) {
        console.error('[Radio panel] search failed:', e);
    }
}

async function panelRequest(trackId, btn) {
    btn.disabled = true;
    btn.textContent = '…';
    const name = (common.settingsStore.get('requesterName') || '').trim().slice(0, 40);
    try {
        const fd = new FormData();
        const ch = common.settingsStore.get('channel');
        if (ch) fd.append('channel', ch);
        fd.append('track_id', String(trackId));
        fd.append('lid', listenerId);
        fd.append('name', name);
        fd.append('src', SOURCE);
        const res = await fetch(`${RADIO_API}?action=request`, {method: 'POST', body: fd});
        const data = await res.json();
        if (!data.success) {
            panelStatus(data.error || 'Request failed', true);
            btn.disabled = false;
            btn.textContent = 'Request';
            return;
        }
        panel.requests = panel.requests || {};
        panel.requests.queue = data.queue || [];
        panel.requests.cooldown_s = data.cooldown_s || 0;
        panelRenderQueue();
        btn.textContent = 'Queued';
        panelStatus(`🎙️ "${data.track.title}" is in the queue (#${data.position}). It plays after the current track${data.position > 1 ? ' and the requests before it' : ''}.`);
        setTimeout(() => {
            panel.el.search.value = '';
            panel.el.results.innerHTML = '';
            panel.lastQuery = '';
        }, 2500);
    } catch (e) {
        panelStatus('Network error, try again', true);
        btn.disabled = false;
        btn.textContent = 'Request';
    }
}

function buildPanel() {
    const content = document.getElementById('content');
    const root = document.createElement('div');
    root.className = 'panel';
    root.innerHTML = `
        <div class="nowrow">
            <div class="cover"></div>
            <div class="info"><div class="title"></div><div class="artist"></div><div class="nextreq"></div></div>
        </div>
        <div class="row votes"></div>
        <div class="phead">Stations</div>
        <div class="chips"></div>
        <div class="phead">Request a song</div>
        <input type="text" class="reqsearch" placeholder="Type part of a title…" autocomplete="off">
        <div class="reqlist results"></div>
        <div class="status"></div>
        <div class="phead">Up next by request</div>
        <div class="reqlist queue"><span class="muted">No requests yet.</span></div>`;
    content.appendChild(root);
    const e = panel.el;
    e.nowCover = root.querySelector('.nowrow .cover');
    e.nowTitle = root.querySelector('.nowrow .title');
    e.nowArtist = root.querySelector('.nowrow .artist');
    e.nowLine = root.querySelector('.nowrow .nextreq');
    e.chips = root.querySelector('.chips');
    e.search = root.querySelector('.reqsearch');
    e.results = root.querySelector('.results');
    e.status = root.querySelector('.status');
    e.queue = root.querySelector('.queue');

    const votes = root.querySelector('.votes');
    e.voteUp = button('vote', 'up', 'I like this track');
    e.voteDown = button('vote', 'down', 'Not my cup of tea');
    e.voteUp.addEventListener('click', () => panelVote(8));
    e.voteDown.addEventListener('click', () => panelVote(3));
    e.feedback = document.createElement('span');
    e.feedback.className = 'feedback';
    const filler = document.createElement('span');
    filler.className = 'filler';
    const openSite = button('ext', 'external', 'Open the radio on lucadegre.it');
    openSite.addEventListener('click', () => {
        const ch = common.settingsStore.get('channel');
        window.open(`${BASE}/nowplay/radio/${ch ? encodeURIComponent(ch) : ''}`, '_blank');
    });
    votes.append(e.voteUp, e.voteDown, e.feedback, filler, openSite);

    e.search.addEventListener('input', panelSearchInput);
    e.results.addEventListener('click', ev => {
        const b = ev.target.closest('button.rbtn[data-id]');
        if (b && !b.disabled) panelRequest(parseInt(b.dataset.id, 10), b);
    });
}

export async function panelMain() {
    common.initInteractionListeners();
    buildPanel();
    panel.channels = await apiChannels();
    panelRenderChips();
    await panelRefresh();
    setInterval(panelRefresh, POLL_MS);
    common.settingsStore.addEventListener('changed', ev => {
        if (ev.data.changed.has('channel')) {
            panelRenderChips();
            panelRefresh();
        }
    });
}

// =====================================================
// SETTINGS WINDOW
// =====================================================

export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#options')();
    const select = document.querySelector('select[name="channel"]');
    if (!select) return;
    const channels = await apiChannels();
    for (const ch of channels) {
        const opt = document.createElement('option');
        opt.value = ch.slug || '';
        opt.textContent = ch.name;
        select.appendChild(opt);
    }
    select.value = common.settingsStore.get('channel') || '';
}
