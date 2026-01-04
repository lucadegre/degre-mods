/**
 * DEGRE Power Bar
 * Dynamic power zone visualization with customizable zones
 */

import * as common from '/pages/src/common.mjs';

const doc = document.documentElement;

// Default zone configuration
const defaultZones = [
    { threshold: 0,   color: '#666666' }, // Z1 - Recovery
    { threshold: 1.5, color: '#2244dd' }, // Z2 - Endurance
    { threshold: 2.5, color: '#55bb55' }, // Z3 - Tempo
    { threshold: 3.5, color: '#dddd33' }, // Z4 - Threshold
    { threshold: 4.5, color: '#ffaa00' }, // Z5 - VO2max
    { threshold: 5.5, color: '#bb2222' }, // Z6 - Anaerobic
    { threshold: 6.5, color: '#aa00bb' }  // Z7 - Neuromuscular
];

// Default settings
common.settingsStore.setDefault({
    orientation: 'vertical',
    reverse: false,
    opacity: 1,
    maxWkg: 10,
    maxWatts: 1000,
    displayMode: 'wkg',
    // Background settings
    bgTransparent: false,
    bgColor: '#283f57',
    hideWhen: 'never',
    // Zone thresholds
    z1Threshold: 0,
    z2Threshold: 1.5,
    z3Threshold: 2.5,
    z4Threshold: 3.5,
    z5Threshold: 4.5,
    z6Threshold: 5.5,
    z7Threshold: 6.5,
    // Zone colors
    z1Color: '#666666',
    z2Color: '#2244dd',
    z3Color: '#55bb55',
    z4Color: '#dddd33',
    z5Color: '#ffaa00',
    z6Color: '#bb2222',
    z7Color: '#aa00bb'
});

// State
let athleteWeight = null;
let athleteFtp = null;
let gameConnection = false;
let lastPower = 0;
let lastSpeed = 0;
let lastWkg = 0;
let isInRace = false;

// DOM Elements
let container, wrapper, fill;

/**
 * Get settings directly from localStorage (bypass cache)
 */
function getSettingsDirect() {
    const key = 'degre-powerbar-settings-v1';
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('[PowerBar] Error reading settings:', e);
    }
    return common.settingsStore.get();
}

/**
 * Get zones from settings
 */
function getZones() {
    const settings = getSettingsDirect();
    return [
        { threshold: settings.z1Threshold || 0, color: settings.z1Color || '#666666' },
        { threshold: settings.z2Threshold || 1.5, color: settings.z2Color || '#2244dd' },
        { threshold: settings.z3Threshold || 2.5, color: settings.z3Color || '#55bb55' },
        { threshold: settings.z4Threshold || 3.5, color: settings.z4Color || '#dddd33' },
        { threshold: settings.z5Threshold || 4.5, color: settings.z5Color || '#ffaa00' },
        { threshold: settings.z6Threshold || 5.5, color: settings.z6Color || '#bb2222' },
        { threshold: settings.z7Threshold || 6.5, color: settings.z7Color || '#aa00bb' }
    ];
}

/**
 * Generate CSS gradient from zones
 */
function generateGradient(orientation, reverse) {
    const settings = common.settingsStore.get();
    const zones = getZones();
    const maxWkg = settings.maxWkg || 10;
    
    // Determine gradient direction based on orientation and reverse
    let direction;
    if (orientation === 'vertical') {
        direction = reverse ? 'to bottom' : 'to top';
    } else {
        direction = reverse ? 'to left' : 'to right';
    }
    
    // Calculate percentage stops based on thresholds
    const stops = [];
    for (let i = 0; i < zones.length; i++) {
        const startPercent = (zones[i].threshold / maxWkg) * 100;
        const endPercent = i < zones.length - 1 
            ? (zones[i + 1].threshold / maxWkg) * 100 
            : 100;
        
        stops.push(`${zones[i].color} ${startPercent}%`);
        stops.push(`${zones[i].color} ${endPercent}%`);
    }
    
    return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/**
 * Calculate percentage based on power/weight
 */
function calculatePercentage(power, weight) {
    const settings = common.settingsStore.get();
    const displayMode = settings.displayMode || 'wkg';
    
    let percentage = 0;
    
    if (displayMode === 'wkg' && weight > 0) {
        const wkg = power / weight;
        lastWkg = wkg;
        const maxWkg = settings.maxWkg || 10;
        percentage = (wkg / maxWkg) * 100;
    } else if (displayMode === 'watts') {
        const maxWatts = settings.maxWatts || 1000;
        percentage = (power / maxWatts) * 100;
        if (weight > 0) lastWkg = power / weight;
    } else if (weight > 0) {
        const wkg = power / weight;
        lastWkg = wkg;
        const maxWkg = settings.maxWkg || 10;
        percentage = (wkg / maxWkg) * 100;
    }
    
    return Math.min(Math.max(percentage, 0), 100);
}

/**
 * Check if current W/kg exceeds max zone threshold
 */
function isAboveMaxZone() {
    const zones = getZones();
    const maxThreshold = zones[zones.length - 1].threshold;
    return lastWkg >= maxThreshold;
}

/**
 * Update power bar display
 */
function updatePowerBar(power, weight) {
    const settings = common.settingsStore.get();
    const orientation = settings.orientation || 'vertical';
    const percentage = calculatePercentage(power, weight);
    
    // Update wrapper size
    if (orientation === 'vertical') {
        wrapper.style.height = `${percentage}%`;
        wrapper.style.width = '';  // Let CSS handle it via left/right
    } else {
        wrapper.style.width = `${percentage}%`;
        wrapper.style.height = '';  // Let CSS handle it via top/bottom
    }
    
    // Glow effect when above max zone
    if (isAboveMaxZone() && power > 0) {
        fill.classList.add('glow');
    } else {
        fill.classList.remove('glow');
    }
    
    // No-data state
    container.classList.toggle('no-data', power === 0);
    
    // Handle visibility based on racing status
    updateVisibility();
}

/**
 * Update visibility based on hideWhen setting
 */
function updateVisibility() {
    const settings = common.settingsStore.get();
    const hideWhen = settings.hideWhen || 'never';
    
    let shouldHide = false;
    
    if (hideWhen === 'speed0' && lastSpeed === 0) {
        shouldHide = true;
    } else if (hideWhen === 'watts0' && lastPower === 0) {
        shouldHide = true;
    }
    
    container.classList.toggle('hidden-by-setting', shouldHide);
}

/**
 * Apply visual settings
 */
function applySettings() {
    const settings = getSettingsDirect();
    console.log('[PowerBar] Applying settings:', JSON.stringify({
        z1Color: settings.z1Color,
        z2Color: settings.z2Color,
        bgColor: settings.bgColor,
        bgTransparent: settings.bgTransparent,
        orientation: settings.orientation,
        reverse: settings.reverse
    }));
    
    const orientation = settings.orientation || 'vertical';
    const reverse = settings.reverse || false;
    
    // Orientation
    container.classList.remove('vertical', 'horizontal');
    container.classList.add(orientation);
    
    // Reverse
    container.classList.toggle('reverse', reverse);
    
    // Widget opacity (applies to entire widget including background)
    const opacity = settings.opacity !== undefined ? settings.opacity : 1;
    container.style.setProperty('--widget-opacity', opacity);
    
    // Background and padding
    if (settings.bgTransparent) {
        container.style.setProperty('--bg-color', 'transparent');
        container.classList.remove('with-padding');
    } else {
        container.style.setProperty('--bg-color', settings.bgColor || '#000000');
        container.classList.add('with-padding');
    }
    
    // Update gradient with custom zones
    const gradient = generateGradient(orientation, reverse);
    console.log('[PowerBar] Generated gradient:', gradient);
    fill.style.background = gradient;
    
    // Update container size
    updateContainerSize();
    
    // Update visibility
    updateVisibility();
}

/**
 * Update CSS variables for container dimensions
 */
function updateContainerSize() {
    const rect = container.getBoundingClientRect();
    container.style.setProperty('--container-height', `${rect.height}px`);
    container.style.setProperty('--container-width', `${rect.width}px`);
}

/**
 * Initialize DOM elements
 */
function initDOM() {
    const content = document.getElementById('content');
    
    container = document.createElement('div');
    container.className = 'powerbar-container vertical';
    
    wrapper = document.createElement('div');
    wrapper.className = 'powerbar-wrapper';
    
    fill = document.createElement('div');
    fill.className = 'powerbar-fill';
    
    wrapper.appendChild(fill);
    container.appendChild(wrapper);
    
    content.appendChild(container);
    
    // Resize listener
    window.addEventListener('resize', updateContainerSize);
}

/**
 * Main entry point
 */
export async function main() {
    common.initInteractionListeners();
    
    // Initialize DOM
    initDOM();
    
    // Apply initial settings
    applySettings();
    
    // Initialize container dimensions
    setTimeout(updateContainerSize, 50);
    
    // Show initial state (small bar visible)
    updatePowerBar(0, 70);
    
    // Game connection status
    const gcs = await common.rpc.getGameConnectionStatus();
    gameConnection = !!(gcs && gcs.connected);
    doc.classList.toggle('game-connection', gameConnection);
    
    // Subscribe to connection status
    common.subscribe('status', gcs => {
        gameConnection = gcs.connected;
        doc.classList.toggle('game-connection', gameConnection);
    }, {source: 'gameConnection'});
    
    // Subscribe to athlete data
    common.subscribe('athlete/watching', watching => {
        if (!watching || !watching.state) {
            updatePowerBar(0, athleteWeight || 70);
            return;
        }
        
        // Update weight
        if (watching.athlete && watching.athlete.weight) {
            athleteWeight = watching.athlete.weight;
        } else if (watching.state.weight) {
            athleteWeight = watching.state.weight;
        }
        
        // Update FTP
        if (watching.athlete && watching.athlete.ftp) {
            athleteFtp = watching.athlete.ftp;
        }
        
        // Check if in race (eventPosition > 0 means we're in an event)
        const eventPosition = watching.state.eventPosition || watching.eventPosition || 0;
        isInRace = eventPosition > 0;
        
        const power = watching.state.power || 0;
        const speed = watching.state.speed || 0;
        const weight = athleteWeight || 70;
        lastPower = power;
        lastSpeed = speed;
        
        updatePowerBar(power, weight);
    });
    
    // Settings change listener
    common.settingsStore.addEventListener('changed', ev => {
        console.log('[PowerBar] Settings changed event:', ev.data.changed);
        applySettings();
        updatePowerBar(lastPower, athleteWeight || 70);
    });
    
    // Fallback: poll settings every 2 seconds (in case events don't work across windows)
    setInterval(() => {
        applySettings();
    }, 2000);
}

/**
 * Settings page entry point
 */
export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#options')();
    
    // Add manual listeners for color inputs (framework might not handle them)
    const form = document.querySelector('form#options');
    if (form) {
        const colorInputs = form.querySelectorAll('input[type="color"]');
        colorInputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const name = e.target.name;
                const value = e.target.value;
                console.log('[PowerBar Settings] Color changed:', name, value);
                common.settingsStore.set(name, value);
            });
            input.addEventListener('change', (e) => {
                const name = e.target.name;
                const value = e.target.value;
                console.log('[PowerBar Settings] Color confirmed:', name, value);
                common.settingsStore.set(name, value);
            });
        });
        console.log('[PowerBar Settings] Added listeners to', colorInputs.length, 'color inputs');
        
        // Add manual listeners for zone threshold inputs
        const thresholdInputs = form.querySelectorAll('.zone-threshold input[type="number"]');
        thresholdInputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const name = e.target.name;
                const value = parseFloat(e.target.value);
                console.log('[PowerBar Settings] Threshold changed:', name, value);
                common.settingsStore.set(name, value);
            });
            input.addEventListener('change', (e) => {
                const name = e.target.name;
                const value = parseFloat(e.target.value);
                console.log('[PowerBar Settings] Threshold confirmed:', name, value);
                common.settingsStore.set(name, value);
            });
        });
        console.log('[PowerBar Settings] Added listeners to', thresholdInputs.length, 'threshold inputs');
    }
}
