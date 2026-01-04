/**
 * DEGRE Finish Well v1.1
 * Final kilometers countdown with bell, sprint loop, and applause
 */

import * as common from '/pages/src/common.mjs';

// === DEFAULT SETTINGS ===
common.settingsStore.setDefault({
    // Visibility
    visibilityDistance: 3000,
    visibilityAlways: false,
    // Background
    bgTransparent: false,
    bgColor: '#000000',
    opacity: 1,
    // Font
    fontAutoSize: true,
    fontSize: 80,
    // Audio
    audioVolume: 70,
    bellDistance: 1000,
    sprintDistance: 300,
    sprintAutodetect: false,
    sprintPowerThreshold: 600,
    audioApplause: true
});

// === STATE ===
const state = {
    currentState: 'HIDDEN', // HIDDEN, VISIBLE, FINISHED
    distanceRemaining: 0,
    eventSubgroupId: 0,
    eventDistance: 0,
    currentPower: 0,
    // Audio flags
    bellPlayed: false,
    sprintPlaying: false,
    sprintArmed: false,
    applausePlayed: false,
    finishedTime: null
};

// === AUDIO ===
const audio = {
    bell: null,
    sprint: null,
    applause: null
};

// === DOM ===
let elements = {};

// === EVENT CACHE ===
let eventCache = {};

// === SETTINGS DIRECT READ ===
function getSettingsDirect() {
    const key = 'degre-finishwell-settings-v1';
    try {
        const stored = localStorage.getItem(key);
        if (stored) return JSON.parse(stored);
    } catch (e) {
        console.error('[FinishWell] Error reading settings:', e);
    }
    return common.settingsStore.get();
}

// === EVENT HELPERS ===
async function getEventDistance(subgroupId) {
    if (eventCache[subgroupId]) return eventCache[subgroupId];
    try {
        const subgroup = await common.rpc.getEventSubgroup(subgroupId);
        if (subgroup) {
            const distance = subgroup.distanceInMeters || subgroup.routeDistance || 0;
            eventCache[subgroupId] = distance;
            return distance;
        }
    } catch (e) {
        console.error('[FinishWell] Error:', e);
    }
    return 0;
}

// === AUDIO ===
function initAudio() {
    audio.bell = new Audio('audio/bell.mp3');
    audio.sprint = new Audio('audio/sprint.mp3');
    audio.sprint.loop = true;
    audio.applause = new Audio('audio/applause.mp3');
    updateAudioVolume();
}

function updateAudioVolume() {
    const vol = (common.settingsStore.get('audioVolume') || 70) / 100;
    Object.values(audio).forEach(a => { if (a) a.volume = vol; });
}

function playBell() {
    const settings = common.settingsStore.get();
    if (!settings.bellDistance || state.bellPlayed) return;
    state.bellPlayed = true;
    audio.bell?.play().catch(() => {});
}

function startSprintLoop() {
    if (state.sprintPlaying) return;
    state.sprintPlaying = true;
    audio.sprint?.play().catch(() => {});
    console.log('[FinishWell] Sprint loop started');
}

function stopSprintLoop() {
    if (!state.sprintPlaying) return;
    state.sprintPlaying = false;
    if (audio.sprint) {
        audio.sprint.pause();
        audio.sprint.currentTime = 0;
    }
    console.log('[FinishWell] Sprint loop stopped');
}

function playApplause() {
    const settings = common.settingsStore.get();
    if (!settings.audioApplause) return;
    audio.applause?.play().catch(() => {});
}

// === SPRINT LOGIC ===
function checkSprint() {
    const settings = common.settingsStore.get();
    const sprintDistance = settings.sprintDistance || 0;
    
    // Sprint disabled
    if (sprintDistance <= 0) return;
    
    // Not in sprint zone yet
    if (state.distanceRemaining > sprintDistance || state.distanceRemaining <= 0) {
        state.sprintArmed = false;
        return;
    }
    
    // Already playing
    if (state.sprintPlaying) return;
    
    // In sprint zone
    if (settings.sprintAutodetect) {
        // Autodetect mode: arm and wait for power threshold
        state.sprintArmed = true;
        const threshold = settings.sprintPowerThreshold || 600;
        if (state.currentPower >= threshold) {
            startSprintLoop();
        }
    } else {
        // Distance-based mode: start immediately
        startSprintLoop();
    }
}

// === DISPLAY ===
function formatDistance(meters) {
    return Math.round(meters).toString();
}

function updateDisplay() {
    const settings = getSettingsDirect();
    applyBackground();
    applyFontSize();
    
    const visDistance = settings.visibilityAlways ? Infinity : (settings.visibilityDistance || 3000);
    const isVisible = (state.distanceRemaining <= visDistance && state.distanceRemaining > 0) 
                      || state.currentState === 'FINISHED';
    
    if (isVisible) {
        elements.container.classList.remove('dimmed');
    } else {
        elements.container.classList.add('dimmed');
    }
    
    if (state.currentState === 'FINISHED') {
        // Show checkered flag instead of 0
        elements.distance.textContent = '🏁';
        elements.distance.classList.add('finished');
    } else if (state.distanceRemaining > 0) {
        elements.distance.textContent = formatDistance(state.distanceRemaining);
        elements.distance.classList.remove('finished');
    } else {
        elements.distance.textContent = '';
        elements.distance.classList.remove('finished');
    }
}

// === BACKGROUND ===
function applyBackground() {
    const settings = getSettingsDirect();
    
    if (settings.bgTransparent) {
        elements.container.style.setProperty('--bg-color', 'transparent');
    } else {
        elements.container.style.setProperty('--bg-color', settings.bgColor || '#000000');
    }
    
    const opacity = settings.opacity !== undefined ? settings.opacity : 1;
    elements.container.style.setProperty('--widget-opacity', opacity);
}

// === FONT SIZE ===
function applyFontSize() {
    const settings = getSettingsDirect();
    
    if (settings.fontAutoSize !== false) {
        // Auto-size: use viewport units
        elements.distance.style.fontSize = '';
        elements.distance.classList.add('auto-size');
    } else {
        // Manual size
        elements.distance.classList.remove('auto-size');
        elements.distance.style.fontSize = `${settings.fontSize || 80}px`;
    }
}

// === DATA HANDLER ===
async function onAthleteUpdate(athleteData) {
    if (!athleteData?.state) return;
    
    const settings = common.settingsStore.get();
    const athleteState = athleteData.state;
    
    // Update current power for autodetect
    state.currentPower = athleteState.power || 0;
    
    // Check if in event
    const eventSubgroupId = athleteState.eventSubgroupId || 0;
    
    if (eventSubgroupId > 0) {
        state.eventSubgroupId = eventSubgroupId;
        
        const eventDistance = await getEventDistance(eventSubgroupId);
        if (eventDistance > 0) {
            state.eventDistance = eventDistance;
            const elapsedDistance = athleteState.eventDistance || 0;
            state.distanceRemaining = Math.max(0, eventDistance - elapsedDistance);
        }
        
        // Check for finish
        if (state.currentState === 'FINISHED') return;
        
        if (state.distanceRemaining < 10 && state.currentState !== 'HIDDEN') {
            state.currentState = 'FINISHED';
            state.finishedTime = Date.now();
            stopSprintLoop();
            
            // Play applause only once (check flag)
            if (!state.applausePlayed) {
                state.applausePlayed = true;
                playApplause();
            }
            
            updateDisplay();
            return;
        }
        
        state.currentState = 'VISIBLE';
        
        // Check bell
        if (settings.bellDistance && state.distanceRemaining <= settings.bellDistance && !state.bellPlayed) {
            playBell();
        }
        
        // Check sprint
        checkSprint();
        
    } else {
        if (state.currentState !== 'HIDDEN') resetState();
    }
    
    updateDisplay();
}

// === RESET ===
function resetState() {
    state.currentState = 'HIDDEN';
    state.distanceRemaining = 0;
    state.eventSubgroupId = 0;
    state.eventDistance = 0;
    state.currentPower = 0;
    state.bellPlayed = false;
    state.sprintArmed = false;
    state.applausePlayed = false;
    stopSprintLoop();
    state.finishedTime = null;
    updateDisplay();
}

// === INIT ===
function initDOM() {
    elements = {
        container: document.getElementById('content'),
        distance: document.getElementById('distance')
    };
}

export async function main() {
    common.initInteractionListeners();
    initDOM();
    initAudio();
    
    applyBackground();
    applyFontSize();
    
    // Initial state
    elements.distance.textContent = '';
    elements.container.classList.add('dimmed');
    
    // Subscription
    common.subscribe('athlete/watching', onAthleteUpdate);
    
    // Settings changes
    common.settingsStore.addEventListener('changed', () => {
        updateAudioVolume();
        applyBackground();
        applyFontSize();
        updateDisplay();
    });
    
    // Poll settings
    setInterval(() => {
        applyBackground();
        applyFontSize();
    }, 2000);
    
    console.log('[DEGRE Finish Well v1.1] Initialized');
}

export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#options')();
    
    // Handle transparent checkbox
    const transparentCheckbox = document.querySelector('input[name="bgTransparent"]');
    const colorPicker = document.querySelector('input[name="bgColor"]');
    
    function updateColorPickerState() {
        if (transparentCheckbox && colorPicker) {
            colorPicker.disabled = transparentCheckbox.checked;
            colorPicker.style.opacity = transparentCheckbox.checked ? '0.3' : '1';
        }
    }
    
    setTimeout(updateColorPickerState, 100);
    if (transparentCheckbox) {
        transparentCheckbox.addEventListener('change', updateColorPickerState);
    }
    
    // Handle "Always" checkbox for visibility
    const alwaysCheckbox = document.querySelector('input[name="visibilityAlways"]');
    const distanceInput = document.querySelector('input[name="visibilityDistance"]');
    
    function updateDistanceState() {
        if (alwaysCheckbox && distanceInput) {
            distanceInput.disabled = alwaysCheckbox.checked;
            distanceInput.style.opacity = alwaysCheckbox.checked ? '0.4' : '1';
        }
    }
    
    setTimeout(updateDistanceState, 100);
    if (alwaysCheckbox) {
        alwaysCheckbox.addEventListener('change', updateDistanceState);
    }
    
    // Handle auto-size checkbox
    const autoSizeCheckbox = document.querySelector('input[name="fontAutoSize"]');
    const fontSizeInput = document.querySelector('input[name="fontSize"]');
    
    function updateFontSizeState() {
        if (autoSizeCheckbox && fontSizeInput) {
            fontSizeInput.disabled = autoSizeCheckbox.checked;
            fontSizeInput.style.opacity = autoSizeCheckbox.checked ? '0.4' : '1';
        }
    }
    
    setTimeout(updateFontSizeState, 100);
    if (autoSizeCheckbox) {
        autoSizeCheckbox.addEventListener('change', updateFontSizeState);
    }
    
    // Handle sprint autodetect checkbox
    const autodetectCheckbox = document.querySelector('input[name="sprintAutodetect"]');
    const powerThresholdRow = document.querySelector('.sprint-threshold-row');
    
    function updateAutodetectState() {
        if (autodetectCheckbox && powerThresholdRow) {
            powerThresholdRow.style.display = autodetectCheckbox.checked ? '' : 'none';
        }
    }
    
    setTimeout(updateAutodetectState, 100);
    if (autodetectCheckbox) {
        autodetectCheckbox.addEventListener('change', updateAutodetectState);
    }
    
    // Manual listeners for color inputs
    const colorInputs = document.querySelectorAll('input[type="color"]');
    colorInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            common.settingsStore.set(e.target.name, e.target.value);
        });
        input.addEventListener('change', (e) => {
            common.settingsStore.set(e.target.name, e.target.value);
        });
    });
}
