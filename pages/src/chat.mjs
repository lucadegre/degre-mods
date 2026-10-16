/**
 * DEGRE Chat Translate v1.0
 * Zwift chat with every message translated into your language.
 *
 * Written from scratch on the public Sauce4Zwift mod API (the same calls the
 * built-in Chat window uses: subscribe('chat'), rpc.getChatHistory). No code
 * is copied from Sauce's own chat page, so this file stays under the DEGRE
 * Mods licence.
 *
 * READ ONLY by design: Sauce follows the race with its own Fan View
 * account, so it cannot write in the rider's name and never sees direct
 * messages. The team writes with SpeakOn (voice -> Zwift chat).
 *
 * Translation engines:
 *  - "google" (default): Google Translate's free web endpoint. No key, no
 *    setup. It also tells us the source language, so messages already in
 *    your language are left alone. Unofficial: if Google throttles it (429)
 *    the engine pauses for a while and messages show untranslated.
 *  - "gemini": Google Gemini with the rider's OWN API key (same idea as
 *    SpeakOn). Understands Zwift slang ("RO", "pull", "sit in") instead of
 *    translating word by word. On any Gemini error the message falls back
 *    to the free engine, and a Gemini rate limit pauses Gemini for a minute.
 *
 * Cost control: an LRU cache (same text -> same translation), at most two
 * requests in flight, and no request at all for messages without letters
 * or made only of chat-isms everybody understands ("RO", "gg", "thx").
 */

import * as sauce from '/pages/src/../../shared/sauce/index.mjs';
import * as common from '/pages/src/common.mjs';

const H = sauce.locale.human;

common.settingsStore.setDefault({
    targetLang: 'auto',        // 'auto' = language of this computer
    engine: 'google',          // google | gemini
    geminiKey: '',
    showOriginal: true,
    cleanup: 120,              // seconds before a message fades out (0 = never)
    reverseOrder: false,
    rightAlign: false,
    showLive: true,            // power / HR / gap of the sender under the name
    messageTransparency: 30,
    textSize: 100,             // percent of the normal text size (60-160)
    solidBackground: false,
    backgroundColor: '#00ff00',
    demo: false,               // fake foreign messages, to try it off-game (reopen the window)
    ttsMode: 'team',           // read aloud: off | team | all
                               // (no direct messages: Sauce reads the chat with its own
                               //  Fan View account, DMs to the rider never reach it)
    ttsName: true,             // say who wrote it ("Marco: ...")
    ttsVoice: '',              // '' = first voice of the target language
    ttsRate: 1.1,
    ttsVolume: 100,
});

export const LANGUAGES = [
    ['auto', 'Same as this computer'],
    ['en', 'English'], ['it', 'Italiano'], ['de', 'Deutsch'], ['fr', 'Français'],
    ['es', 'Español'], ['nl', 'Nederlands'], ['pt', 'Português'], ['pl', 'Polski'],
    ['da', 'Dansk'], ['sv', 'Svenska'], ['no', 'Norsk'], ['fi', 'Suomi'],
    ['cs', 'Čeština'], ['hu', 'Magyar'], ['ro', 'Română'], ['el', 'Ελληνικά'],
    ['tr', 'Türkçe'], ['ru', 'Русский'], ['uk', 'Українська'], ['ja', '日本語'],
    ['ko', '한국어'], ['zh-CN', '中文 (简体)'], ['zh-TW', '中文 (繁體)'],
];

// Whole messages that every Zwifter reads in any language: never translated
const UNIVERSAL = new Set([
    'ro', 'ride on', 'rideon', 'gg', 'gl', 'glhf', 'thx', 'thanks', 'ty', 'lol',
    'ok', 'okay', 'k', 'yes', 'no', 'go', 'gogogo', 'go go go', 'hi', 'hello',
    'bye', 'brb', 'wtf', 'omg', 'nice', 'gj', 'wp', 'gz', 'grats', 'ciao',
]);

const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/single';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GOOGLE_PAUSE_MS = 10 * 60 * 1000;
const GEMINI_PAUSE_MS = 60 * 1000;
const GEMINI_TIMEOUT_MS = 5000;
const GOOGLE_TIMEOUT_MS = 5000;
const MAX_IN_FLIGHT = 2;
const CACHE_MAX = 400;
const FADEOUT_S = 5;

const GEMINI_INSTRUCTION =
    'You translate chat messages typed by riders in Zwift, the indoor cycling game. ' +
    'They are short, casual, often with typos and slang: keep the tone. Common terms: ' +
    'RO / Ride On (a cheer, keep as "Ride On"), pull, sit in, draft, gap, sprint, KOM, ' +
    'lap, ZRL, TTT, PowerUp, Watopia, w/kg, FTP, bonk, drop / dropped, attack, regroup. ' +
    'Keep numbers, units, names and emoji as they are. If the message is already in the ' +
    'target language, or has nothing to translate, reply with exactly __SAME__. ' +
    'Otherwise output ONLY the translation: no quotes, no notes, no alternatives.';


// =====================================================
// TRANSLATION
// =====================================================

function targetLang() {
    const t = common.settingsStore.get('targetLang') || 'auto';
    if (t !== 'auto') {
        return t;
    }
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('zh')) {
        return nav.includes('tw') || nav.includes('hk') ? 'zh-TW' : 'zh-CN';
    }
    return nav.split('-')[0];
}

function langLabel(code) {
    return (code || '').toUpperCase().replace('ZH-CN', 'ZH').replace('ZH-TW', 'ZH');
}

function needsTranslation(text) {
    const t = (text || '').trim();
    if (t.length < 2 || !/\p{L}/u.test(t)) {
        return false;
    }
    const norm = t.toLowerCase().replace(/[!.?,:;)(\s]+/g, ' ').trim();
    return !UNIVERSAL.has(norm);
}

const cache = new Map();   // key "lang|text" -> {text, from} ; text null = no translation needed
function cacheGet(k) {
    if (!cache.has(k)) {
        return undefined;
    }
    const v = cache.get(k);
    cache.delete(k);          // refresh LRU position
    cache.set(k, v);
    return v;
}
function cachePut(k, v) {
    cache.set(k, v);
    if (cache.size > CACHE_MAX) {
        cache.delete(cache.keys().next().value);
    }
}

const pausedUntil = {google: 0, gemini: 0};
let lastNotice = '';

function notice(msg) {
    if (msg === lastNotice) {
        return;
    }
    lastNotice = msg;
    const el = document.querySelector('#translate-status');
    if (el) {
        el.textContent = msg;
        el.classList.toggle('visible', !!msg);
    }
}

async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, {...opts, signal: ctrl.signal});
    } finally {
        clearTimeout(to);
    }
}

async function translateGoogle(text, tl) {
    const url = `${GOOGLE_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetchWithTimeout(url, {}, GOOGLE_TIMEOUT_MS);
    if (resp.status === 429) {
        pausedUntil.google = Date.now() + GOOGLE_PAUSE_MS;
        notice('Translation paused for a few minutes (Google limit)');
        throw new Error('throttled');
    }
    if (!resp.ok) {
        throw new Error(`google ${resp.status}`);
    }
    const data = await resp.json();
    const from = (data?.[2] || '').toLowerCase();
    if (from && (from === tl.toLowerCase() || from.split('-')[0] === tl.split('-')[0])) {
        return {text: null, from};
    }
    const out = (data?.[0] || []).map(seg => seg?.[0] || '').join('').trim();
    if (!out || out === text.trim()) {
        return {text: null, from};
    }
    return {text: out, from};
}

// Gemini model discovery: Google renames models often, so ask the key which
// flash models it can use and take the newest "lite" (fast, free-tier friendly)
let geminiModel = {key: '', name: ''};

async function pickGeminiModel(key) {
    if (geminiModel.key === key && geminiModel.name) {
        return geminiModel.name;
    }
    const resp = await fetchWithTimeout(`${GEMINI_BASE}/models?pageSize=200`,
        {headers: {'x-goog-api-key': key}}, GEMINI_TIMEOUT_MS);
    if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
        throw new Error('Google rejected the key (check that you copied all of it)');
    }
    if (!resp.ok) {
        throw new Error(`Gemini answered ${resp.status}, try again in a minute`);
    }
    const names =((await resp.json()).models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => (m.name || '').replace(/^models\//, ''));
    const ver = n => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const stable = names.filter(n => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n));
    const pool = stable.length ? stable : names.filter(n => /^gemini-\d+(\.\d+)?-flash/.test(n));
    pool.sort((a, b) => ((b.includes('-lite') - a.includes('-lite')) || (ver(b) - ver(a))));
    if (!pool.length) {
        throw new Error('no flash model for this key');
    }
    geminiModel = {key, name: pool[0]};
    return pool[0];
}

async function translateGemini(text, tl, key) {
    const model = await pickGeminiModel(key);
    const langName = (LANGUAGES.find(l => l[0] === tl) || [tl, tl])[1];
    const thinking = ver => ver >= 3 ? {thinkingLevel: 'minimal'} : {thinkingBudget: 0};
    const v = parseFloat((model.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const body = withThinking => ({
        system_instruction: {parts: [{text: GEMINI_INSTRUCTION}]},
        contents: [{role: 'user', parts: [{text: `Target language: ${langName} (${tl}).\n\nMessage: ${text}`}]}],
        generationConfig: Object.assign({temperature: 0.2, maxOutputTokens: 512},
            withThinking ? {thinkingConfig: thinking(v)} : {}),
    });
    const url = `${GEMINI_BASE}/models/${model}:generateContent`;
    const post = b => fetchWithTimeout(url, {
        method: 'POST',
        headers: {'content-type': 'application/json', 'x-goog-api-key': key},
        body: JSON.stringify(b),
    }, GEMINI_TIMEOUT_MS);
    let resp = await post(body(true));
    if (resp.status === 400) {
        resp = await post(body(false));   // model doesn't accept the thinking knob
    }
    if (resp.status === 404) {
        geminiModel = {key: '', name: ''};   // model retired: rediscover next time
    }
    if (resp.status === 429 || resp.status === 503) {
        pausedUntil.gemini = Date.now() + GEMINI_PAUSE_MS;
        notice('Gemini busy: using the free translator for a minute');
        throw new Error(`gemini ${resp.status}`);
    }
    if (!resp.ok) {
        throw new Error(`gemini ${resp.status}`);
    }
    const data = await resp.json();
    const out = (data?.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '').join('').trim().replace(/^["“]|["”]$/g, '');
    if (!out || out.includes('__SAME__') || out === text.trim()) {
        return {text: null, from: ''};
    }
    return {text: out, from: ''};
}

let inFlight = 0;
const waiting = [];

async function withSlot(fn) {
    if (inFlight >= MAX_IN_FLIGHT) {
        await new Promise(resolve => waiting.push(resolve));
    }
    inFlight++;
    try {
        return await fn();
    } finally {
        inFlight--;
        const next = waiting.shift();
        if (next) {
            next();
        }
    }
}

/**
 * Resolves to {text, from} where text is the translation or null when the
 * message should be shown as is (already in your language, nothing to
 * translate, or every engine unavailable).
 */
async function translate(text) {
    const tl = targetLang();
    if (!needsTranslation(text)) {
        return {text: null, from: ''};
    }
    const k = `${tl}|${text}`;
    const hit = cacheGet(k);
    if (hit !== undefined) {
        return hit;
    }
    const s = common.settingsStore.get();
    const now = Date.now();
    const useGemini = s.engine === 'gemini' && s.geminiKey && pausedUntil.gemini < now;
    let result = null;
    await withSlot(async () => {
        if (useGemini) {
            try {
                result = await translateGemini(text, tl, s.geminiKey.trim());
            } catch (e) {
                console.warn('Gemini translation failed, falling back:', e.message);
            }
        }
        if (!result && pausedUntil.google < Date.now()) {
            try {
                result = await translateGoogle(text, tl);
            } catch (e) {
                console.warn('Google translation failed:', e.message);
            }
        }
    });
    if (!result) {
        return {text: null, from: '', failed: true};   // not cached: try again next time
    }
    if (pausedUntil.google < Date.now() && pausedUntil.gemini < Date.now()) {
        notice('');
    }
    cachePut(k, result);
    return result;
}

/** One-shot check for the settings page: {ok, message}. */
export async function testGeminiKey(key) {
    key = (key || '').trim();
    if (!key) {
        return {ok: false, message: 'Paste your key first.'};
    }
    try {
        geminiModel = {key: '', name: ''};
        const model = await pickGeminiModel(key);
        const r = await translateGemini('Nice pull, sit in for a bit and then we go!', targetLang() === 'en' ? 'it' : targetLang(), key);
        return {ok: true, message: `Key OK (${model}): “${r.text || 'no translation needed'}”`};
    } catch (e) {
        return {ok: false, message: `Key not working: ${e.message}`};
    }
}


// =====================================================
// READ ALOUD (text to speech, the computer's own voices)
// =====================================================

const TTS_MAX_QUEUE = 3;        // a burst of messages: the oldest unread are dropped
const TTS_MAX_CHARS = 220;
const ttsState = {muted: false, selfId: null, selfTeam: null, queue: [], speaking: false};

function ttsVoice() {
    if (!('speechSynthesis' in window)) {
        return null;
    }
    const vs = speechSynthesis.getVoices();
    const s = common.settingsStore.get();
    const byName = vs.find(v => v.name === s.ttsVoice);
    if (byName) {
        return byName;
    }
    const tl = targetLang().toLowerCase().split('-')[0];
    return vs.find(v => v.lang?.toLowerCase().startsWith(tl)) || null;
}

function ttsNext() {
    if (ttsState.speaking || !ttsState.queue.length) {
        return;
    }
    const text = ttsState.queue.shift();
    const s = common.settingsStore.get();
    const u = new SpeechSynthesisUtterance(text);
    const v = ttsVoice();
    if (v) {
        u.voice = v;
        u.lang = v.lang;
    } else {
        u.lang = targetLang();
    }
    u.rate = Number(s.ttsRate) || 1;
    u.volume = Math.min(1, Math.max(0, (Number(s.ttsVolume) || 100) / 100));
    ttsState.speaking = true;
    const done = () => {
        ttsState.speaking = false;
        ttsNext();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
}

function teamKey(t) {
    return String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Decide whether a message is read aloud, and queue it. */
function maybeSpeak(chat, text) {
    const s = common.settingsStore.get();
    const mode = s.ttsMode || 'off';
    if (mode === 'off' || ttsState.muted || !('speechSynthesis' in window) || chat.muted || !text) {
        return;
    }
    if (ttsState.selfId && chat.from === ttsState.selfId) {
        return;   // my own messages
    }
    const mate = ttsState.selfTeam && teamKey(chat.team) === ttsState.selfTeam;
    // 'dm' was an option of the first lab build: treated as 'team'
    if ((mode === 'team' || mode === 'dm') && !mate) {
        return;
    }
    let line = String(text).replace(/\s+/g, ' ').trim();
    if (line.length > TTS_MAX_CHARS) {
        line = line.slice(0, TTS_MAX_CHARS) + '…';
    }
    if (s.ttsName !== false && chat.firstName) {
        line = `${chat.firstName}: ${line}`;
    }
    ttsState.queue.push(line);
    while (ttsState.queue.length > TTS_MAX_QUEUE) {
        ttsState.queue.shift();
    }
    ttsNext();
}

async function refreshSelf() {
    try {
        const me = await common.rpc.getAthlete('self');
        if (me) {
            ttsState.selfId = me.id ?? ttsState.selfId;
            ttsState.selfTeam = teamKey(me.team) || null;
        }
    } catch {
        // not connected yet: try again later
    }
}

function syncTtsButton() {
    const b = document.querySelector('#tts-toggle');
    if (!b) {
        return;
    }
    const off = ttsState.muted || (common.settingsStore.get('ttsMode') || 'off') === 'off';
    b.innerHTML = `<ms>${off ? 'volume_off' : 'record_voice_over'}</ms>`;
    b.title = off ? 'Read aloud: off (click to turn on)' : 'Read aloud: on (click to mute)';
    b.classList.toggle('off', off);
}


// =====================================================
// CHAT WINDOW
// =====================================================

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function nowTs() {
    const ts = common.getRealTime();
    return (ts instanceof Promise) ? Date.now() : ts;
}

function fmtAge(ts) {
    const age = (nowTs() - ts) / 1000 | 0;
    return age < 15 ? 'now' : H.relTime(ts, {short: true, maxParts: 1, html: true});
}

function fmtLive(data) {
    if (!data) {
        return '';
    }
    const parts = [];
    const p = data.stats?.power?.smooth?.[15];
    if (p != null) {
        parts.push(H.power(p, {suffix: true, html: true}));
    }
    if (data.state?.heartrate) {
        parts.push(H.number(data.state.heartrate, {suffix: 'bpm', html: true}));
    }
    if (!data.watching && data.gap != null) {
        const d = H.duration(Math.abs(data.gap), {short: true, separator: ' ', html: true});
        parts.push(`${d} <abbr class="unit">${data.gap > 0 ? 'behind' : 'ahead'}</abbr>`);
    }
    return parts.join(', ');
}

function applyLook(doc, content) {
    const s = common.settingsStore.get();
    const op = s.messageTransparency == null ? 0.7 : 1 - (s.messageTransparency / 100);
    doc.style.setProperty('--msg-opacity', op);
    const ts = Math.min(160, Math.max(60, Number(s.textSize) || 100));
    doc.style.setProperty('--text-scale', ts / 100);
    content.classList.toggle('reverse-order', !!s.reverseOrder);
    content.classList.toggle('right-align', !!s.rightAlign);
    doc.classList.toggle('hide-original', !s.showOriginal);
    doc.classList.toggle('hide-live', s.showLive === false);
    common.setBackground(s);
}

export async function main() {
    common.initInteractionListeners();
    const doc = document.documentElement;
    const content = document.querySelector('#content');
    const liveEls = new Map();       // athleteId -> Set of entry elements

    // Keep the newest message in view. No scrollbar: the window follows the
    // chat by itself. Newest at the bottom (normal) or on top (reverse
    // order: with column-reverse Chromium counts scrollTop from the bottom,
    // so the top is the most negative value).
    let pinUntil = 0;
    function pin() {
        content.scrollTop = content.classList.contains('reverse-order') ? -content.scrollHeight : content.scrollHeight;
    }
    function follow(ms = 1300) {
        // Bubbles grow for about a second (slide-in, translation arriving):
        // keep pinning while they do
        const start = !pinUntil || performance.now() > pinUntil;
        pinUntil = Math.max(pinUntil, performance.now() + ms);
        pin();
        if (start) {
            const loop = () => {
                pin();
                if (performance.now() < pinUntil) {
                    requestAnimationFrame(loop);
                } else {
                    pinUntil = 0;
                }
            };
            requestAnimationFrame(loop);
        }
    }
    new ResizeObserver(() => pin()).observe(content);
    document.addEventListener('degre-chat-grew', () => follow(400));
    let connected = false;

    applyLook(doc, content);
    common.settingsStore.addEventListener('changed', () => {
        applyLook(doc, content);
        for (const el of content.querySelectorAll('.entry')) {
            el._armCleanup?.();
        }
        follow(400);
    });

    refreshSelf();
    setInterval(refreshSelf, 60000);
    const ttsBtn = document.querySelector('#tts-toggle');
    if (ttsBtn) {
        ttsBtn.addEventListener('click', () => {
            if ((common.settingsStore.get('ttsMode') || 'off') === 'off') {
                common.settingsStore.set('ttsMode', 'team');
                ttsState.muted = false;
            } else {
                ttsState.muted = !ttsState.muted;
                if (ttsState.muted && 'speechSynthesis' in window) {
                    ttsState.queue = [];
                    speechSynthesis.cancel();
                    ttsState.speaking = false;
                }
            }
            syncTtsButton();
        });
    }
    syncTtsButton();
    common.settingsStore.addEventListener('changed', syncTtsButton);

    const setConn = st => doc.classList.toggle('connected', (connected = !!st?.connected));
    common.subscribe('status', setConn, {source: 'gameConnection', persistent: true});
    setConn(await common.rpc.getGameConnectionStatus());

    function onLive(data) {
        const html = fmtLive(data);
        for (const el of liveEls.get(data.athleteId) || []) {
            const live = el.querySelector('.live');
            if (live && live._html !== html) {
                live.innerHTML = html;
                live._html = html;
            }
        }
    }

    function trackLive(athleteId, el) {
        if (!liveEls.has(athleteId)) {
            liveEls.set(athleteId, new Set());
        }
        const set = liveEls.get(athleteId);
        if (!set.size) {
            common.subscribe(`athlete/${athleteId}`, onLive);
        }
        set.add(el);
        return () => {
            set.delete(el);
            if (!set.size) {
                common.unsubscribe(`athlete/${athleteId}`, onLive);
            }
        };
    }

    // A chunk = one message line: translation on top, original (small) below
    function makeChunk(message, chat = null, speakIt = false) {
        const chunk = document.createElement('div');
        chunk.className = 'chunk pending';
        chunk.innerHTML = `<div class="text">${escapeHtml(message)}</div>`;
        translate(message).then(r => {
            chunk.classList.remove('pending');
            requestAnimationFrame(() => document.dispatchEvent(new Event('degre-chat-grew')));
            if (r.text) {
                chunk.classList.add('translated');
                chunk.innerHTML =
                    `<div class="text">${escapeHtml(r.text)}</div>` +
                    `<div class="original">${r.from ? `<b>${escapeHtml(langLabel(r.from))}</b> ` : ''}${escapeHtml(message)}</div>`;
            } else if (r.failed) {
                chunk.classList.add('untranslated');
                chunk.title = 'Translation not available right now';
            }
            if (speakIt && chat) {
                maybeSpeak(chat, r.text || message);
            }
        });
        return chunk;
    }

    function lastEntry() {
        const all = content.querySelectorAll(':scope > .entry');
        return all[all.length - 1];
    }

    function armCleanup(el, ageS, untrack) {
        let to;
        el._armCleanup = () => {
            clearTimeout(to);
            const secs = common.settingsStore.get('cleanup');
            if (!secs) {
                return;
            }
            to = setTimeout(() => {
                el.classList.add('fadeout');
                el._armCleanup = null;
                untrack?.();
                setTimeout(() => el.remove(), FADEOUT_S * 1000);
            }, Math.max(0, secs - (ageS || 0)) * 1000);
        };
        el._armCleanup();
    }

    function onChat(chat, ageS, opts = {}) {
        const dm = !!chat.to;
        const prev = lastEntry();
        // Consecutive messages from the same rider go in the same bubble
        if (prev && Number(prev.dataset.from) === chat.from && prev.classList.contains('dm') === dm &&
            !prev.classList.contains('fadeout') && !chat.muted && !prev.classList.contains('muted')) {
            prev.dataset.ts = chat.ts;
            prev.querySelector('.message').appendChild(makeChunk(chat.message, chat, !opts.instant));
            follow();
            prev._armCleanup?.();
            return prev;
        }
        const el = document.createElement('div');
        el.className = 'entry' + (dm ? ' dm' : '');
        el.dataset.from = chat.from;
        el.dataset.ts = chat.ts;
        const name = [chat.firstName, chat.lastName].filter(x => x).join(' ');
        let untrack = null;
        if (chat.muted) {
            el.classList.add('muted');
            el.innerHTML = `<div class="body">Muted message from ${escapeHtml(name)}</div>`;
        } else {
            el.style.setProperty('--hue', `${chat.from % 360}deg`);
            el.innerHTML = `
                <a class="avatar" href="/pages/profile.html?id=${chat.from}&windowType=profile"
                   target="profile_popup_${chat.from}"><img src="${escapeHtml(chat.avatar || '/pages/images/blankavatar.png')}"/></a>
                <div class="body">
                    <div class="header">
                        <span class="name">${escapeHtml(name)}</span>
                        ${common.teamBadge(chat.team)}
                        <span class="age">${fmtAge(chat.ts)}</span>
                    </div>
                    <div class="live"></div>
                    <div class="message"></div>
                </div>`;
            el.querySelector('.message').appendChild(makeChunk(chat.message, chat, !opts.instant));
            untrack = trackLive(chat.from, el);
        }
        el.addEventListener('dblclick', () => connected && common.rpc.watch(chat.from));
        content.appendChild(el);
        follow();
        if (!opts.instant) {
            void el.offsetLeft;   // reflow so the slide-in animation runs
        }
        el.classList.add('shown');
        armCleanup(el, ageS, untrack);
        return el;
    }

    setInterval(() => {
        for (const el of content.querySelectorAll('.entry:not(.muted)')) {
            const age = fmtAge(Number(el.dataset.ts));
            if (el._age !== age) {
                el.querySelector('.header .age').innerHTML = age;
                el._age = age;
            }
        }
    }, 5000);

    // History first (oldest -> newest), then live messages
    const cleanup = common.settingsStore.get('cleanup');
    let newest;
    for (const x of (await common.rpc.getChatHistory()).reverse()) {
        const age = (nowTs() - x.ts) / 1000;
        if (cleanup && age > cleanup) {
            continue;
        }
        newest = onChat(x, age, {instant: true});
    }
    if (newest) {
        follow(300);
    }
    common.subscribe('chat', onChat, {persistent: true});

    // "Demo messages" setting (or ?test in the URL): fake foreign-language
    // messages every few seconds, to try the translation without riding
    if (location.search.includes('test') || common.settingsStore.get('demo')) {
        const samples = [
            ['Hans', 'Müller', 'Gute Arbeit, wir holen sie auf der nächsten Runde!'],
            ['Pierre', 'Dubois', 'Qui veut faire le relais avec moi ?'],
            ['Sanne', 'de Vries', 'Ik zit kapot, ik laat me zakken'],
            ['Marta', 'García', 'Vamos equipo, último kilómetro!'],
            ['Kenji', 'Sato', 'ナイスプル！ありがとう'],
            ['Luca', 'Rossi', 'Ragazzi aspettiamo il gruppo alla curva'],
            ['Tom', 'Baker', 'RO'],
            ['Tom', 'Baker', 'Sit in for a bit, I will pull to the KOM'],
        ];
        let i = 0;
        setInterval(() => {
            const [f, l, m] = samples[i++ % samples.length];
            onChat({firstName: f, lastName: l, message: m, from: 1000 + (i % samples.length),
                to: 0, ts: nowTs(), team: i % 3 ? 'DEGRE' : null});
        }, 2500);
    }
}


// =====================================================
// SETTINGS PAGE
// =====================================================

export async function settingsMain() {
    common.initInteractionListeners();
    const sel = document.querySelector('select[name="targetLang"]');
    for (const [code, label] of LANGUAGES) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code === 'auto' ? `${label} (${navigator.language || 'en'})` : label;
        sel.appendChild(opt);
    }
    const vsel = document.querySelector('select[name="ttsVoice"]');
    const fillVoices = () => {
        if (!vsel || !('speechSynthesis' in window)) {
            return;
        }
        const cur = common.settingsStore.get('ttsVoice') || '';
        vsel.innerHTML = '<option value="">automatic (target language)</option>' +
            speechSynthesis.getVoices().map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`).join('');
        vsel.value = cur;
    };
    fillVoices();
    if ('speechSynthesis' in window) {
        speechSynthesis.addEventListener('voiceschanged', fillVoices);
    }
    await common.initSettingsForm('form#options')();
    fillVoices();
    document.querySelector('#try-tts')?.addEventListener('click', ev => {
        ev.preventDefault();
        const tl = targetLang();
        const sample = tl.startsWith('it') ? 'Marco: aspettatemi in cima, arrivo.' :
            tl.startsWith('de') ? 'Marco: wartet oben auf mich, ich komme.' :
            tl.startsWith('fr') ? 'Marco: attendez-moi en haut, j\'arrive.' :
            tl.startsWith('es') ? 'Marco: esperadme arriba, ya llego.' : 'Marco: wait for me at the top, coming.';
        ttsState.queue = [sample];
        ttsState.speaking = false;
        speechSynthesis.cancel();
        ttsNext();
    });

    const testBtn = document.querySelector('#test-key');
    const result = document.querySelector('#test-result');
    testBtn.addEventListener('click', async ev => {
        ev.preventDefault();
        testBtn.disabled = true;
        result.className = 'test-result';
        result.textContent = 'Testing...';
        const r = await testGeminiKey(document.querySelector('input[name="geminiKey"]').value);
        result.textContent = r.message;
        result.classList.add(r.ok ? 'ok' : 'err');
        testBtn.disabled = false;
    });

    document.querySelector('#copy-question').addEventListener('click', async ev => {
        ev.preventDefault();
        const q = 'I need a free Google Gemini API key to translate chat messages in an app. ' +
            "I'm not a developer: explain step by step, with the exact buttons to click in " +
            'Google AI Studio, how to create the key and copy it.';
        try {
            await navigator.clipboard.writeText(q);
            ev.target.textContent = 'Question copied: paste it into Gemini';
        } catch {
            ev.target.textContent = 'Copy failed';
        }
    });
}
