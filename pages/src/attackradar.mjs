/**
 * DEGRE Attack Radar v1.0
 * Attack detection with audio alerts
 */

import * as common from '/pages/src/common.mjs';

// === TRANSLATIONS ===
const i18n = {
    en: {
        opponents: 'Opponents',
        teammates: 'Teammates',
        opponent: 'Opponent',
        teammate: 'Teammate',
        previewAttacker: 'Mario Rossi [TEAMTAG]',
        ahead: 'ahead',
        behind: 'behind'
    },
    it: {
        opponents: 'Avversari',
        teammates: 'Compagni',
        opponent: 'Avversario',
        teammate: 'Compagno',
        previewAttacker: 'Mario Rossi [TEAMTAG]',
        ahead: 'davanti',
        behind: 'dietro'
    },
    fr: {
        opponents: 'Adversaires',
        teammates: 'Coéquipiers',
        opponent: 'Adversaire',
        teammate: 'Coéquipier',
        previewAttacker: 'Mario Rossi [TEAMTAG]',
        ahead: 'devant',
        behind: 'derrière'
    },
    es: {
        opponents: 'Enemigos',
        teammates: 'Compañeros',
        opponent: 'Enemigo',
        teammate: 'Compañero',
        previewAttacker: 'Mario Rossi [TEAMTAG]',
        ahead: 'delante',
        behind: 'detrás'
    }
};

function t(key) {
    const lang = common.settingsStore.get('language') || 'en';
    return i18n[lang]?.[key] || i18n.en[key] || key;
}

// === WEIGHT SIZE CONVERSION ===
function getWeightSize(weight) {
    if (!weight || weight <= 0) return '';
    if (weight < 50) return 'XXXS';
    if (weight <= 53) return 'XXS';
    if (weight <= 58) return 'XS';
    if (weight <= 64) return 'S';
    if (weight <= 71) return 'M';
    if (weight <= 79) return 'L';
    if (weight <= 88) return 'XL';
    if (weight <= 98) return 'XXL';
    return 'XXXL';
}

// === COLOR UTILITIES ===
function isLightColor(hex) {
    // Convert hex to RGB and calculate luminance
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    // Luminance formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
}

function getTextColorForBg(bgColor) {
    return isLightColor(bgColor) ? '#000000' : '#ffffff';
}

// === NAME TRUNCATION ===
function truncateName(name, maxLength = 15) {
    if (!name || name.length <= maxLength) return name;
    return name.substring(0, maxLength - 1) + '…';
}

// === SPRINT MODE LOGIC ===
function updateSprintMode() {
    const settings = getSettingsDirect();
    const thresholdWatts = settings.attackDetectorWatts || 700;
    const thresholdWkg = settings.attackDetectorWkg || 8.0;
    const logic = settings.attackDetectorLogic || 'OR';
    
    const myWkg = state.myWeight > 0 ? state.myPower / state.myWeight : 0;
    const distance = state.distanceRemaining;
    
    // Check if my output exceeds attack thresholds
    let isAttacking = false;
    if (logic === 'OR') {
        isAttacking = state.myPower >= thresholdWatts || myWkg >= thresholdWkg;
    } else {
        isAttacking = state.myPower >= thresholdWatts && myWkg >= thresholdWkg;
    }
    
    // Sprint mode activation: distance < 1000m AND attacking
    if (distance > 0 && distance < 1000 && isAttacking) {
        state.sprintMode = true;
    }
    // Sprint mode deactivation: distance > 300m AND not attacking
    else if (distance > 300 && !isAttacking) {
        state.sprintMode = false;
    }
    // Under 300m: stay in sprint mode if already active
    // (no change if distance <= 300)
}

// === GAP TRACKING ===
function updateGapHistory(athleteId, currentGap) {
    const now = Date.now();
    const history = state.gapHistory[athleteId];
    
    if (!history) {
        state.gapHistory[athleteId] = {
            lastGap: currentGap,
            lastTime: now,
            gapTrend: 0 // 0 = stable, negative = closing, positive = opening
        };
        return 0;
    }
    
    const timeDelta = (now - history.lastTime) / 1000; // seconds
    if (timeDelta > 0.5) { // Update every 0.5s minimum
        const gapDelta = currentGap - history.lastGap;
        const trend = gapDelta / timeDelta; // gap change per second
        
        history.gapTrend = trend;
        history.lastGap = currentGap;
        history.lastTime = now;
    }
    
    return history.gapTrend;
}

// === SPRINT MODE THREAT DETECTION ===
function isSprintThreat(athlete) {
    // Only threats from behind
    if (athlete.relativePos <= 0) return false; // ahead or same position = not a threat
    
    // Check if their speed > my speed
    const theirSpeed = athlete.speed || 0;
    if (theirSpeed <= state.mySpeed) return false;
    
    // Check if gap is closing (negative trend = getting closer)
    const gapTrend = updateGapHistory(athlete.athleteId, athlete.gap || 0);
    if (gapTrend >= 0) return false; // gap stable or opening = not a threat
    
    return true;
}

// === DEFAULT SETTINGS ===
common.settingsStore.setDefault({
    language: 'en',
    // Visibility
    attackDetectorDistance: 5000,
    attackDetectorAlways: false,
    // Opacity
    opacity: 1,
    // Attack detection
    attackDetectorWatts: 700,
    attackDetectorWkg: 8.0,
    attackDetectorLogic: 'OR',
    teamRace: false,
    // Colors
    colorOpponent: '#ff4444',
    colorTeammate: '#55bb55',
    colorAhead: '#fc6719',  // Zwift orange
    colorBehind: '#00bfff', // Zwift blue
    // Audio
    audioEnabled: true,
    audioVolume: 70,
    audioOthers: true,
    audioTeam: true,
    audioMixed: true,
    // Layout preview
    layoutPreview: true
});

// === STATE ===
const state = {
    distanceRemaining: 0,
    eventSubgroupId: 0,
    myAthleteId: null,
    myTeam: null,
    myGroup: null,
    attackers: { enemies: [], teammates: [] },
    // Anti-flicker
    lastAttackerSignature: '',
    // Audio cooldowns
    audioCooldowns: { others: 0, team: 0, mixed: 0 },
    // Layout preview
    previewScenario: 0,
    previewInterval: null,
    // Sprint mode
    sprintMode: false,
    mySpeed: 0,
    myPower: 0,
    myWeight: 70,
    // Gap tracking for sprint mode
    gapHistory: {} // { athleteId: { lastGap, lastTime, gapTrend } }
};

// === AUDIO ===
const audio = {
    others: null,
    team: null,
    mixed: null
};

// === DOM ===
let elements = {};

// === EVENT CACHE ===
let eventCache = {};

// === SETTINGS DIRECT READ ===
function getSettingsDirect() {
    const key = 'degre-attackradar-settings-v1';
    try {
        const stored = localStorage.getItem(key);
        if (stored) return JSON.parse(stored);
    } catch (e) {
        console.error('[AttackRadar] Error reading settings:', e);
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
        console.error('[AttackRadar] Error:', e);
    }
    return 0;
}

// === ATTACK DETECTION ===
function isAttack(power, wkg) {
    const settings = common.settingsStore.get();
    const wattsThreshold = settings.attackDetectorWatts || 700;
    const wkgThreshold = settings.attackDetectorWkg || 8.0;
    const logic = settings.attackDetectorLogic || 'OR';
    
    const aboveWatts = power >= wattsThreshold;
    const aboveWkg = wkg >= wkgThreshold;
    
    if (logic === 'AND') {
        return aboveWatts && aboveWkg;
    } else {
        // OR (default)
        return aboveWatts || aboveWkg;
    }
}

function detectAttacks(group) {
    if (!group || !group.athletes) return { enemies: [], teammates: [] };
    
    const settings = common.settingsStore.get();
    const teamRace = settings.teamRace || false;
    
    const attackers = { enemies: [], teammates: [] };
    
    // Find my position in the group (athletes are sorted by position)
    const myIndex = group.athletes.findIndex(a => a.watching || a.athleteId === state.myAthleteId);
    
    for (let i = 0; i < group.athletes.length; i++) {
        const athlete = group.athletes[i];
        if (!athlete?.state) continue;
        if (athlete.athleteId === state.myAthleteId || athlete.watching) continue;
        
        const power = athlete.state.power || 0;
        const weight = athlete.athlete?.weight || 0;
        const wkg = weight > 0 ? (power / weight) : 0;
        const speed = athlete.state.speed || 0;
        const gap = athlete.gap || 0;
        
        if (!isAttack(power, wkg)) continue;
        
        const name = formatAthleteName(athlete);
        const athleteTeam = athlete.athlete?.team || null;
        const athleteId = athlete.athleteId;
        
        // Position relative to me (negative = ahead, positive = behind)
        const relativePos = myIndex >= 0 ? (i - myIndex) : 0;
        
        const attackerData = { athleteId, name, power, team: athleteTeam, weight, wkg, relativePos, speed, gap };
        
        // Sprint mode filtering: only show threats from behind
        if (state.sprintMode) {
            if (!isSprintThreat(attackerData)) continue;
            attackerData.isSprintThreat = true;
        }
        
        let isTeammate = false;
        if (teamRace && state.myTeam && athleteTeam) {
            isTeammate = athleteTeam === state.myTeam;
        }
        
        if (isTeammate) {
            attackers.teammates.push(attackerData);
        } else {
            attackers.enemies.push(attackerData);
        }
    }
    
    return attackers;
}

function formatAthleteName(athlete) {
    if (!athlete?.athlete) return 'Unknown';
    const a = athlete.athlete;
    let lastName = a.lastName || a.firstName || 'Unknown';
    const team = a.team || null;
    
    // Remove team tag patterns from lastName if team is already known
    // Patterns: [TAG], (TAG), <TAG>, {TAG} or just TAG at end
    if (team) {
        const tagPatterns = [
            new RegExp(`\\s*\\[${team}\\]\\s*`, 'gi'),
            new RegExp(`\\s*\\(${team}\\)\\s*`, 'gi'),
            new RegExp(`\\s*<${team}>\\s*`, 'gi'),
            new RegExp(`\\s*\\{${team}\\}\\s*`, 'gi'),
            new RegExp(`\\s+${team}\\s*$`, 'gi')
        ];
        for (const pattern of tagPatterns) {
            lastName = lastName.replace(pattern, '');
        }
        lastName = lastName.trim();
    }
    
    // Build final name: lastName + [team] if available
    let name = lastName;
    if (team) {
        name += ` [${team}]`;
    }
    
    return name || 'Unknown';
}

// === AUDIO ===
function initAudio() {
    audio.others = new Audio('audio/attack-others.mp3');
    audio.team = new Audio('audio/attack-team.mp3');
    audio.mixed = new Audio('audio/attack-mixed.mp3');
    updateAudioVolume();
}

function updateAudioVolume() {
    const vol = (common.settingsStore.get('audioVolume') || 70) / 100;
    Object.values(audio).forEach(a => { if (a) a.volume = vol; });
}

function playAudio(type) {
    const settings = common.settingsStore.get();
    
    if (settings.audioEnabled === false) return;
    
    const now = Date.now();
    const COOLDOWN_MS = 1000;
    
    switch (type) {
        case 'others':
            if (!settings.audioOthers) return;
            if (now - state.audioCooldowns.others < COOLDOWN_MS) return;
            state.audioCooldowns.others = now;
            audio.others?.play().catch(() => {});
            break;
        case 'team':
            if (!settings.audioTeam) return;
            if (now - state.audioCooldowns.team < COOLDOWN_MS) return;
            state.audioCooldowns.team = now;
            audio.team?.play().catch(() => {});
            break;
        case 'mixed':
            if (!settings.audioMixed) return;
            if (now - state.audioCooldowns.mixed < COOLDOWN_MS) return;
            state.audioCooldowns.mixed = now;
            audio.mixed?.play().catch(() => {});
            break;
    }
}

// === DISPLAY ===
function updateDisplay() {
    const settings = getSettingsDirect();
    applyBackground();
    
    const hasEnemies = state.attackers.enemies.length > 0;
    const hasTeammates = state.attackers.teammates.length > 0;
    
    // "Always" bypasses the distance gate entirely: works in free rides and
    // events without a known total distance (laps/time based).
    const attackDistance = settings.attackDetectorDistance || 5000;
    const attackActive = settings.attackDetectorAlways ||
        (state.distanceRemaining <= attackDistance && state.distanceRemaining > 0);
    const hasAttack = (hasEnemies || hasTeammates) && attackActive;
    
    if (hasAttack) {
        elements.container.classList.remove('dimmed');
    } else {
        elements.container.classList.add('dimmed');
    }
    
    updateAttackBanner(hasEnemies, hasTeammates, hasAttack, settings);
}

function updateAttackBanner(hasEnemies, hasTeammates, hasAttack, settings) {
    const banner = elements.attackBanner;
    
    if (!hasAttack) {
        if (state.lastAttackerSignature !== '') {
            state.lastAttackerSignature = '';
            banner.innerHTML = '';
        }
        return;
    }
    
    const signature = JSON.stringify({
        enemies: state.attackers.enemies.map(a => a.athleteId).sort(),
        teammates: state.attackers.teammates.map(a => a.athleteId).sort()
    });
    
    if (signature === state.lastAttackerSignature) {
        return;
    }
    state.lastAttackerSignature = signature;
    
    banner.innerHTML = '';
    
    const enemyCount = state.attackers.enemies.length;
    const teamCount = state.attackers.teammates.length;
    
    const colorOpponent = settings.colorOpponent || '#ff4444';
    const colorTeammate = settings.colorTeammate || '#55bb55';
    
    if (hasEnemies && hasTeammates) {
        const total = enemyCount + teamCount;
        let enemyPercent = (enemyCount / total) * 100;
        let teamPercent = (teamCount / total) * 100;
        
        if (enemyPercent < 30) { enemyPercent = 30; teamPercent = 70; }
        if (enemyPercent > 70) { enemyPercent = 70; teamPercent = 30; }
        
        banner.appendChild(createAttackBox('opponent', state.attackers.enemies, enemyPercent, colorOpponent));
        banner.appendChild(createAttackBox('teammate', state.attackers.teammates, teamPercent, colorTeammate));
        
    } else if (hasEnemies) {
        const box = createAttackBox('opponent', state.attackers.enemies, 100, colorOpponent);
        box.classList.add('full-width');
        banner.appendChild(box);
        
    } else if (hasTeammates) {
        const box = createAttackBox('teammate', state.attackers.teammates, 100, colorTeammate);
        box.classList.add('full-width');
        banner.appendChild(box);
    }
}

function createAttackBox(type, attackers, widthPercent, color) {
    const settings = getSettingsDirect();
    const colorAhead = settings.colorAhead || '#fc6719';
    const colorBehind = settings.colorBehind || '#00bfff';
    
    const box = document.createElement('div');
    box.className = 'attack-box';
    box.style.background = `linear-gradient(180deg, ${color} 0%, ${adjustColor(color, -30)} 100%)`;
    
    if (widthPercent < 100) {
        box.classList.add('proportional');
        box.style.flex = `0 0 calc(${widthPercent}% - 4px)`;
    }
    
    const count = attackers.length;
    
    // Count ahead/behind
    let aheadCount = 0, behindCount = 0;
    for (const a of attackers) {
        if (a.relativePos < 0) aheadCount++;
        else if (a.relativePos > 0) behindCount++;
    }
    
    // Check for sprint threat (pulsing animation)
    if (attackers.some(a => a.isSprintThreat)) {
        box.classList.add('sprint-threat');
    }
    
    const isMixed = aheadCount > 0 && behindCount > 0;
    
    // Create badge container (always on top)
    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'badge-container';
    
    if (isMixed) {
        // Mixed: two badges side by side
        if (aheadCount > 0) {
            const badgeAhead = document.createElement('span');
            badgeAhead.className = 'position-badge';
            badgeAhead.style.background = colorAhead;
            badgeAhead.style.color = getTextColorForBg(colorAhead);
            badgeAhead.innerHTML = `${aheadCount}▲`;
            badgeContainer.appendChild(badgeAhead);
        }
        if (behindCount > 0) {
            const badgeBehind = document.createElement('span');
            badgeBehind.className = 'position-badge';
            badgeBehind.style.background = colorBehind;
            badgeBehind.style.color = getTextColorForBg(colorBehind);
            badgeBehind.innerHTML = `${behindCount}▼`;
            badgeContainer.appendChild(badgeBehind);
        }
    } else {
        // Single direction: one badge
        const badge = document.createElement('span');
        badge.className = 'position-badge';
        if (aheadCount > 0) {
            badge.style.background = colorAhead;
            badge.style.color = getTextColorForBg(colorAhead);
            badge.innerHTML = `▲ ${t('ahead').toUpperCase()}`;
        } else if (behindCount > 0) {
            badge.style.background = colorBehind;
            badge.style.color = getTextColorForBg(colorBehind);
            badge.innerHTML = `▼ ${t('behind').toUpperCase()}`;
        }
        if (aheadCount > 0 || behindCount > 0) {
            badgeContainer.appendChild(badge);
        }
    }
    
    if (badgeContainer.children.length > 0) {
        box.appendChild(badgeContainer);
    }
    
    if (count === 1) {
        // Single attacker: name + stats on one line
        const attacker = attackers[0];
        box.classList.add('single-attacker');
        
        const infoLine = document.createElement('div');
        infoLine.className = 'attacker-info-line';
        
        const name = truncateName(attacker.name, 15);
        const power = attacker.power || 0;
        const wkg = attacker.wkg || 0;
        const weight = attacker.weight || 0;
        
        const parts = [name];
        parts.push(`${power}W`);
        if (wkg > 0) parts.push(`${wkg.toFixed(1)}w/kg`);
        const size = getWeightSize(weight);
        if (size) parts.push(size);
        
        infoLine.textContent = parts.join(' · ');
        box.appendChild(infoLine);
        
    } else if (count > 1) {
        // Multiple attackers
        box.classList.add('multi-attacker');
        
        if (isMixed) {
            // Mixed: just count, no stats
            const countLine = document.createElement('div');
            countLine.className = 'attacker-count';
            countLine.textContent = `${count} ${t(type + 's')}`;
            box.appendChild(countLine);
        } else {
            // Same direction: count + stats on one line
            let totalPower = 0, totalWkg = 0, validWkg = 0;
            for (const a of attackers) {
                totalPower += a.power || 0;
                if (a.wkg > 0) {
                    totalWkg += a.wkg;
                    validWkg++;
                }
            }
            const avgPower = Math.round(totalPower / count);
            const avgWkg = validWkg > 0 ? (totalWkg / validWkg) : 0;
            
            const infoLine = document.createElement('div');
            infoLine.className = 'attacker-info-line';
            
            const parts = [`${count} ${t(type + 's')}`];
            parts.push(`Ø ${avgPower}W`);
            if (avgWkg > 0) parts.push(`${avgWkg.toFixed(1)}w/kg`);
            
            infoLine.textContent = parts.join(' · ');
            box.appendChild(infoLine);
        }
    }
    
    return box;
}

function adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
    const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

// === BACKGROUND ===
function applyBackground() {
    const settings = getSettingsDirect();
    const opacity = settings.opacity !== undefined ? settings.opacity : 1;
    elements.container.style.setProperty('--widget-opacity', opacity);
}

// === LAYOUT PREVIEW ===
function startLayoutPreview() {
    if (state.previewInterval) return;
    
    state.previewScenario = 0;
    updatePreviewScenario();
    
    // Show preview indicator
    if (elements.previewIndicator) {
        elements.previewIndicator.classList.add('visible');
    }
    
    state.previewInterval = setInterval(() => {
        state.previewScenario = (state.previewScenario + 1) % 5;
        updatePreviewScenario();
    }, 4000);
}

function stopLayoutPreview() {
    if (!state.previewInterval) return;
    
    clearInterval(state.previewInterval);
    state.previewInterval = null;
    state.lastAttackerSignature = '';
    elements.attackBanner.innerHTML = '';
    elements.container.classList.add('dimmed');
    
    // Hide preview indicator
    if (elements.previewIndicator) {
        elements.previewIndicator.classList.remove('visible');
    }
}

function updatePreviewScenario() {
    const settings = getSettingsDirect();
    const colorOpponent = settings.colorOpponent || '#ff4444';
    const colorTeammate = settings.colorTeammate || '#55bb55';
    const banner = elements.attackBanner;
    
    banner.innerHTML = '';
    state.lastAttackerSignature = 'preview';
    
    elements.container.classList.remove('dimmed');
    
    switch (state.previewScenario) {
        case 0:
            // Mixed attack - multiple opponents and teammates
            const mixedEnemies = [
                { name: 'Rossi', power: 680, wkg: 8.5, weight: 80, relativePos: -2 },
                { name: 'Bianchi', power: 650, wkg: 7.8, weight: 83, relativePos: -1 },
                { name: 'Verdi', power: 620, wkg: 8.2, weight: 76, relativePos: 1 }
            ];
            const mixedTeam = [
                { name: 'Neri', power: 600, wkg: 7.5, weight: 80, relativePos: -3 },
                { name: 'Gialli', power: 590, wkg: 7.9, weight: 75, relativePos: 2 }
            ];
            banner.appendChild(createAttackBox('opponent', mixedEnemies, 60, colorOpponent));
            banner.appendChild(createAttackBox('teammate', mixedTeam, 40, colorTeammate));
            break;
        case 1:
            // Multiple opponents only (all ahead)
            const multiOpp = [
                { name: 'Rossi', power: 700, wkg: 8.7, weight: 80, relativePos: -3 },
                { name: 'Bianchi', power: 680, wkg: 8.5, weight: 80, relativePos: -1 },
                { name: 'Verdi', power: 660, wkg: 8.2, weight: 80, relativePos: -2 }
            ];
            const boxOpp = createAttackBox('opponent', multiOpp, 100, colorOpponent);
            boxOpp.classList.add('full-width');
            banner.appendChild(boxOpp);
            break;
        case 2:
            // Multiple teammates only (mixed positions)
            const multiTeam = [
                { name: 'Neri', power: 620, wkg: 7.7, weight: 80, relativePos: -1 },
                { name: 'Gialli', power: 600, wkg: 7.5, weight: 80, relativePos: 2 }
            ];
            const boxTeam = createAttackBox('teammate', multiTeam, 100, colorTeammate);
            boxTeam.classList.add('full-width');
            banner.appendChild(boxTeam);
            break;
        case 3:
            // Single attacker ahead with full details
            const singleAhead = [{
                name: 'Rossi [TSE]',
                power: 650,
                wkg: 8.1,
                weight: 80,
                relativePos: -5
            }];
            const boxAhead = createAttackBox('opponent', singleAhead, 100, colorOpponent);
            boxAhead.classList.add('full-width');
            banner.appendChild(boxAhead);
            break;
        case 4:
            // Single teammate behind with full details
            const singleBehind = [{
                name: 'Bianchi [TSE]',
                power: 580,
                wkg: 7.2,
                weight: 80,
                relativePos: 3
            }];
            const boxBehind = createAttackBox('teammate', singleBehind, 100, colorTeammate);
            boxBehind.classList.add('full-width');
            banner.appendChild(boxBehind);
            break;
    }
}

function checkLayoutPreview() {
    const settings = getSettingsDirect();
    
    if (settings.layoutPreview) {
        startLayoutPreview();
    } else {
        stopLayoutPreview();
    }
}

// === AUDIO TOGGLE ===
function getAudioIcon(enabled) {
    if (enabled) {
        return `<svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </svg>`;
    } else {
        return `<svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
        </svg>`;
    }
}

function toggleAudioEnabled() {
    const current = common.settingsStore.get('audioEnabled');
    const newValue = current === false ? true : false;
    common.settingsStore.set('audioEnabled', newValue);
    updateAudioToggleIcon();
}

function updateAudioToggleIcon() {
    const enabled = common.settingsStore.get('audioEnabled') !== false;
    elements.audioToggle.innerHTML = getAudioIcon(enabled);
    elements.audioToggle.classList.toggle('muted', !enabled);
}

// === DATA HANDLERS ===
async function onAthleteUpdate(athleteData) {
    if (state.previewInterval) return;
    if (!athleteData?.state) return;
    
    const settings = common.settingsStore.get();
    const athleteState = athleteData.state;
    
    state.myAthleteId = athleteData.athleteId;
    
    // Capture my data for sprint mode
    state.myPower = athleteState.power || 0;
    state.mySpeed = athleteState.speed || 0;
    if (athleteData.athlete?.weight) {
        state.myWeight = athleteData.athlete.weight;
    }
    
    if (settings.teamRace && athleteData.athlete) {
        state.myTeam = athleteData.athlete.team || null;
    }
    
    const eventSubgroupId = athleteState.eventSubgroupId || 0;
    
    if (eventSubgroupId > 0) {
        state.eventSubgroupId = eventSubgroupId;
        
        const eventDistance = await getEventDistance(eventSubgroupId);
        if (eventDistance > 0) {
            const elapsedDistance = athleteState.eventDistance || 0;
            state.distanceRemaining = Math.max(0, eventDistance - elapsedDistance);
        }
    } else {
        state.distanceRemaining = 0;
        state.sprintMode = false;
        // With "Always" on, attackers come from onGroupsUpdate even outside
        // events — clearing them here would make the banner flicker.
        if (!settings.attackDetectorAlways) {
            state.attackers = { enemies: [], teammates: [] };
        }
    }
    
    // Update sprint mode
    updateSprintMode();
    
    updateDisplay();
}

function onGroupsUpdate(groups) {
    if (state.previewInterval) return;
    if (!groups || !groups.length) return;
    
    // Find the group containing the watched athlete
    state.myGroup = groups.find(g => g.athletes?.some(a => a.watching));
    
    if (!state.myGroup) {
        state.attackers = { enemies: [], teammates: [] };
        updateDisplay();
        return;
    }
    
    const settings = common.settingsStore.get();
    const attackDistance = settings.attackDetectorDistance || 5000;

    // "Always" bypasses the distance gate: detection also runs in free rides
    // and in events without a known total distance (laps/time based), where
    // distanceRemaining stays 0.
    if (!settings.attackDetectorAlways &&
        (state.distanceRemaining > attackDistance || state.distanceRemaining <= 0)) {
        state.attackers = { enemies: [], teammates: [] };
        updateDisplay();
        return;
    }
    
    state.attackers = detectAttacks(state.myGroup);
    
    const hasEnemies = state.attackers.enemies.length > 0;
    const hasTeammates = state.attackers.teammates.length > 0;
    
    if (hasEnemies && hasTeammates) {
        playAudio('mixed');
    } else if (hasEnemies) {
        playAudio('others');
    } else if (hasTeammates) {
        playAudio('team');
    }
    
    updateDisplay();
}

// === INIT ===
function initDOM() {
    elements = {
        container: document.getElementById('content'),
        attackBanner: document.getElementById('attack-banner'),
        previewIndicator: document.getElementById('preview-indicator')
    };
    
    elements.audioToggle = document.createElement('div');
    elements.audioToggle.className = 'audio-toggle';
    elements.audioToggle.innerHTML = getAudioIcon(true);
    elements.audioToggle.addEventListener('click', toggleAudioEnabled);
    elements.container.appendChild(elements.audioToggle);
    
    updateAudioToggleIcon();
}

export async function main() {
    common.initInteractionListeners();
    initDOM();
    initAudio();
    
    applyBackground();
    elements.container.classList.add('dimmed');
    
    checkLayoutPreview();
    
    common.subscribe('athlete/watching', onAthleteUpdate);
    common.subscribe('groups', onGroupsUpdate);
    
    common.settingsStore.addEventListener('changed', (ev) => {
        updateAudioVolume();
        applyBackground();
        updateAudioToggleIcon();
        
        if (ev.data.changed.has('layoutPreview')) {
            checkLayoutPreview();
        }
        
        if (state.previewInterval) {
            updatePreviewScenario();
        } else {
            updateDisplay();
        }
    });
    
    setInterval(() => {
        applyBackground();
        checkLayoutPreview();
    }, 2000);
    
    console.log('[DEGRE Attack Radar v1.0] Initialized');
}

export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#options')();
    
    // Handle "Always" checkbox
    const alwaysCheckbox = document.querySelector('input[name="attackDetectorAlways"]');
    const distanceInput = document.querySelector('input[name="attackDetectorDistance"]');
    
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
    
    // Audio preview buttons
    const previewButtons = document.querySelectorAll('.audio-preview');
    previewButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const audioType = btn.dataset.audio;
            const audioFile = {
                'others': 'audio/attack-others.mp3',
                'team': 'audio/attack-team.mp3',
                'mixed': 'audio/attack-mixed.mp3'
            }[audioType];
            
            if (audioFile) {
                const vol = (common.settingsStore.get('audioVolume') || 70) / 100;
                const previewAudio = new Audio('../' + audioFile);
                previewAudio.volume = vol;
                previewAudio.play().catch(() => {});
            }
        });
    });
}
