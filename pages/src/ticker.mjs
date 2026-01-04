/**
 * DEGRE Ticker v1.0
 * Scrolling text widget with visibility cycling
 */

import * as common from '/pages/src/common.mjs';

// === DEFAULT SETTINGS ===
common.settingsStore.setDefault({
    // Text
    text: 'Your scrolling text here... Configure in settings!',
    // Appearance
    fontFamily: 'Roboto',
    fontSize: 24,
    textColor: '#ffffff',
    // Background
    bgMode: 'transparent', // transparent, solid, gradient
    bgColor1: '#000000',
    bgColor2: '#333333',
    gradientDirection: 'horizontal',
    opacity: 1,
    // Scroll
    speed: 5,
    direction: 'rtl', // rtl = right to left, ltr = left to right
    // Visibility cycle
    cycleEnabled: false,
    showFor: 60,
    showMode: 'seconds', // seconds, minutes, loops
    hideFor: 15,
    hideUnit: 'minutes' // seconds, minutes
});

// === STATE ===
const state = {
    isVisible: true,
    loopCount: 0,
    cycleTimeout: null,
    showStartTime: null
};

// === DOM ===
let elements = {};

// === SETTINGS DIRECT READ ===
function getSettingsDirect() {
    const key = 'degre-ticker-settings-v1';
    try {
        const stored = localStorage.getItem(key);
        if (stored) return JSON.parse(stored);
    } catch (e) {
        console.error('[Ticker] Error reading settings:', e);
    }
    return common.settingsStore.get();
}

// === BACKGROUND ===
function applyBackground() {
    const settings = getSettingsDirect();
    const container = elements.container;
    
    switch (settings.bgMode) {
        case 'transparent':
            container.style.setProperty('--bg-color', 'transparent');
            break;
        case 'solid':
            container.style.setProperty('--bg-color', settings.bgColor1 || '#000000');
            break;
        case 'gradient':
            const dir = settings.gradientDirection === 'vertical' ? 'to bottom' : 'to right';
            const c1 = settings.bgColor1 || '#000000';
            const c2 = settings.bgColor2 || '#333333';
            container.style.setProperty('--bg-color', `linear-gradient(${dir}, ${c1}, ${c2})`);
            break;
    }
    
    const opacity = settings.opacity !== undefined ? settings.opacity : 1;
    container.style.setProperty('--widget-opacity', opacity);
}

// === TEXT STYLING ===
function applyTextStyle() {
    const settings = getSettingsDirect();
    const container = elements.container;
    
    // Font family
    let fontStack = settings.fontFamily || 'Roboto';
    switch (fontStack) {
        case 'Roboto':
            fontStack = "'Roboto', sans-serif";
            break;
        case 'Roboto Mono':
            fontStack = "'Roboto Mono', monospace";
            break;
        case 'Arial':
            fontStack = "Arial, sans-serif";
            break;
        case 'Georgia':
            fontStack = "Georgia, serif";
            break;
        case 'Impact':
            fontStack = "Impact, sans-serif";
            break;
        case 'Comic Sans':
            fontStack = "'Comic Sans MS', cursive";
            break;
    }
    container.style.setProperty('--font-family', fontStack);
    
    // Font size
    container.style.setProperty('--font-size', `${settings.fontSize || 24}px`);
    
    // Text color
    container.style.setProperty('--text-color', settings.textColor || '#ffffff');
}

// === SCROLL ANIMATION ===
function applyScrollSettings() {
    const settings = getSettingsDirect();
    const wrapper = elements.wrapper;
    
    // Direction
    wrapper.classList.remove('ltr', 'rtl');
    wrapper.classList.add(settings.direction || 'rtl');
    
    // Speed: 1 = slow (20s), 10 = fast (2s)
    // Calculate based on text length for consistent feel
    const baseSpeed = 21 - (settings.speed || 5) * 2; // 19s to 1s range
    const textLength = (settings.text || '').length;
    const duration = Math.max(2, baseSpeed * (textLength / 50)); // Scale by text length
    
    elements.container.style.setProperty('--scroll-duration', `${duration}s`);
}

// === UPDATE TEXT ===
function updateText() {
    const settings = getSettingsDirect();
    const text = settings.text || 'Your scrolling text here...';
    
    // Update both text elements (duplicated for seamless loop)
    elements.text1.textContent = text;
    elements.text2.textContent = text;
    
    // Recalculate scroll speed based on new text
    applyScrollSettings();
}

// === VISIBILITY CYCLE ===
function startVisibilityCycle() {
    const settings = getSettingsDirect();
    
    if (!settings.cycleEnabled) {
        // Always visible
        elements.container.classList.remove('hidden-cycle');
        state.isVisible = true;
        clearTimeout(state.cycleTimeout);
        return;
    }
    
    // Start with visible
    showTicker();
}

function showTicker() {
    const settings = getSettingsDirect();
    
    state.isVisible = true;
    state.loopCount = 0;
    state.showStartTime = Date.now();
    elements.container.classList.remove('hidden-cycle');
    
    if (settings.showMode === 'loops') {
        // Will be handled by animation iteration event
        return;
    }
    
    // Time-based hide
    let showMs = settings.showFor || 60;
    if (settings.showMode === 'minutes') {
        showMs *= 60;
    }
    showMs *= 1000;
    
    state.cycleTimeout = setTimeout(() => {
        hideTicker();
    }, showMs);
}

function hideTicker() {
    const settings = getSettingsDirect();
    
    state.isVisible = false;
    elements.container.classList.add('hidden-cycle');
    
    // Calculate hide duration
    let hideMs = settings.hideFor || 15;
    if (settings.hideUnit === 'minutes') {
        hideMs *= 60;
    }
    hideMs *= 1000;
    
    state.cycleTimeout = setTimeout(() => {
        showTicker();
    }, hideMs);
}

function onAnimationIteration() {
    const settings = getSettingsDirect();
    
    if (!settings.cycleEnabled || settings.showMode !== 'loops' || !state.isVisible) {
        return;
    }
    
    state.loopCount++;
    
    if (state.loopCount >= (settings.showFor || 3)) {
        hideTicker();
    }
}

// === APPLY ALL SETTINGS ===
function applyAllSettings() {
    applyBackground();
    applyTextStyle();
    updateText();
    applyScrollSettings();
}

// === INIT DOM ===
function initDOM() {
    elements.container = document.getElementById('content');
    
    // Ticker container
    const tickerContainer = document.createElement('div');
    tickerContainer.className = 'ticker-container';
    
    // Wrapper (animated)
    elements.wrapper = document.createElement('div');
    elements.wrapper.className = 'ticker-wrapper rtl';
    
    // Text elements (duplicated for seamless loop)
    elements.text1 = document.createElement('span');
    elements.text1.className = 'ticker-text';
    
    elements.text2 = document.createElement('span');
    elements.text2.className = 'ticker-text';
    
    elements.wrapper.appendChild(elements.text1);
    elements.wrapper.appendChild(elements.text2);
    tickerContainer.appendChild(elements.wrapper);
    elements.container.appendChild(tickerContainer);
    
    // Listen for animation iteration (for loop counting)
    elements.wrapper.addEventListener('animationiteration', onAnimationIteration);
}

// === MAIN ===
export async function main() {
    common.initInteractionListeners();
    initDOM();
    
    applyAllSettings();
    startVisibilityCycle();
    
    // Settings changes
    common.settingsStore.addEventListener('changed', (ev) => {
        applyAllSettings();
        
        // Restart cycle if cycle settings changed
        if (ev.data.changed.has('cycleEnabled') || 
            ev.data.changed.has('showFor') || 
            ev.data.changed.has('showMode') ||
            ev.data.changed.has('hideFor') ||
            ev.data.changed.has('hideUnit')) {
            clearTimeout(state.cycleTimeout);
            startVisibilityCycle();
        }
    });
    
    // Poll settings
    setInterval(() => {
        applyAllSettings();
    }, 2000);
    
    console.log('[DEGRE Ticker v1.0] Initialized');
}

// === SETTINGS PAGE ===
export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#options')();
    
    // Handle textarea for text (needs manual listener)
    const textArea = document.querySelector('textarea[name="text"]');
    if (textArea) {
        // Set initial value
        const currentText = common.settingsStore.get('text');
        if (currentText) {
            textArea.value = currentText;
        }
        
        // Save on input
        textArea.addEventListener('input', (e) => {
            common.settingsStore.set('text', e.target.value);
            // Update char count
            const charCount = document.getElementById('charCount');
            if (charCount) charCount.textContent = e.target.value.length;
        });
    }
    
    // Handle background mode changes
    const bgModeSelect = document.querySelector('select[name="bgMode"]');
    const bgColor1 = document.querySelector('input[name="bgColor1"]');
    const bgColor2 = document.querySelector('input[name="bgColor2"]');
    const gradientDir = document.querySelector('select[name="gradientDirection"]');
    
    function updateBgFieldsVisibility() {
        const mode = bgModeSelect?.value || 'transparent';
        
        if (bgColor1) {
            bgColor1.closest('label').style.display = 
                mode === 'transparent' ? 'none' : '';
        }
        if (bgColor2) {
            bgColor2.closest('label').style.display = 
                mode === 'gradient' ? '' : 'none';
        }
        if (gradientDir) {
            gradientDir.closest('label').style.display = 
                mode === 'gradient' ? '' : 'none';
        }
    }
    
    if (bgModeSelect) {
        setTimeout(updateBgFieldsVisibility, 100);
        bgModeSelect.addEventListener('change', updateBgFieldsVisibility);
    }
    
    // Handle cycle enable changes
    const cycleEnabled = document.querySelector('input[name="cycleEnabled"]');
    const cycleFields = document.querySelectorAll('.cycle-field');
    
    function updateCycleFieldsVisibility() {
        const enabled = cycleEnabled?.checked || false;
        cycleFields.forEach(field => {
            field.style.display = enabled ? '' : 'none';
        });
    }
    
    if (cycleEnabled) {
        setTimeout(updateCycleFieldsVisibility, 100);
        cycleEnabled.addEventListener('change', updateCycleFieldsVisibility);
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
