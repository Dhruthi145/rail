/**
 * RailGuard AI - Dashboard & Core Application JavaScript
 * Handles system clock, sidebar toggling, KPI number counting,
 * telemetry polling from Flask API, pipeline status flow, and alert feed.
 */

document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initSidebar();
    initAnimatedCounters();
    initTelemetryPolling();
    initSearchFilter();
    initTopbarNotifications();
    initDashboardAudioControls();
});

/* --------------------------------------------------------------------------
   1. Real-Time System Clock
   -------------------------------------------------------------------------- */
function initClock() {
    const timeEl = document.getElementById('liveClockTime');
    const dateEl = document.getElementById('liveClockDate');
    if (!timeEl && !dateEl) return;

    function update() {
        const now = new Date();
        // Time format: 10:24:15 AM
        const hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const formattedHours = String(hours % 12 || 12).padStart(2, '0');

        if (timeEl) {
            timeEl.textContent = `${formattedHours}:${minutes}:${seconds} ${ampm}`;
        }

        // Date format: 05 Sep 2026
        if (dateEl) {
            const options = { day: '2-digit', month: 'short', year: 'numeric' };
            dateEl.textContent = now.toLocaleDateString('en-GB', options);
        }
    }

    update();
    setInterval(update, 1000);
}

/* --------------------------------------------------------------------------
   2. Responsive Sidebar Toggle
   -------------------------------------------------------------------------- */
function initSidebar() {
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebar = document.getElementById('appSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggleBtn || !sidebar) return;

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('sidebar-open');
        if (overlay) overlay.classList.toggle('active');
    });

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('sidebar-open');
            overlay.classList.remove('active');
        });
    }
}

/* --------------------------------------------------------------------------
   3. Animated Number Counters
   -------------------------------------------------------------------------- */
function initAnimatedCounters() {
    const counters = document.querySelectorAll('.counter-val');
    counters.forEach(counter => {
        const target = +counter.getAttribute('data-target') || 0;
        const duration = 1200; // ms
        const startTime = performance.now();

        function updateCount(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(easeProgress * target);
            counter.textContent = current < 10 ? `0${current}` : current;

            if (progress < 1) {
                requestAnimationFrame(updateCount);
            } else {
                counter.textContent = target < 10 ? `0${target}` : target;
            }
        }
        requestAnimationFrame(updateCount);
    });
}

/* --------------------------------------------------------------------------
   4. Real-Time Telemetry Polling (Flask /api/telemetry)
   -------------------------------------------------------------------------- */
let lastLoggedRisk = 'SAFE';

function initTelemetryPolling() {
    pollTelemetry();
    setInterval(pollTelemetry, 1500);
}

async function pollTelemetry() {
    try {
        const response = await fetch('/api/telemetry');
        if (!response.ok) return;
        const data = await response.json();
        updateDashboardTelemetry(data);
    } catch (err) {
        console.warn('Telemetry polling notice:', err);
    }
}

function updateDashboardTelemetry(data) {
    // 1. Update KPI numbers if present
    const personsEl = document.getElementById('telemetryPersons');
    const trainsEl = document.getElementById('telemetryTrains');
    const speedEl = document.getElementById('telemetrySpeed');
    const distEl = document.getElementById('telemetryDistance');
    const ttcEl = document.getElementById('telemetryTTC');
    const riskBadgeEl = document.getElementById('telemetryRiskBadge');
    const workerEl = document.getElementById('telemetryWorker');

    if (personsEl) personsEl.textContent = data.person_count < 10 ? `0${data.person_count}` : data.person_count;
    if (trainsEl) trainsEl.textContent = data.train_count < 10 ? `0${data.train_count}` : data.train_count;
    if (speedEl) speedEl.textContent = `${Number(data.train_speed || 0).toFixed(1)} km/h`;
    if (distEl) distEl.textContent = `${Number(data.distance || 0).toFixed(1)} m`;

    if (ttcEl) {
        if (data.ttc === 'N/A' || data.ttc === null || data.ttc >= 999) {
            ttcEl.textContent = '--';
            ttcEl.classList.remove('text-danger', 'fw-bold');
        } else {
            ttcEl.textContent = `${Number(data.ttc).toFixed(1)}s`;
            if (data.ttc < 5.0) {
                ttcEl.classList.add('text-danger', 'fw-bold');
            }
        }
    }

    if (workerEl) {
        if (data.verification_status === 'AUTHORIZED') {
            workerEl.innerHTML = `<span class="badge bg-success text-white"><i class="fa-solid fa-hard-hat me-1"></i>${data.worker_id || 'EMP001'} (PPE+Face OK)</span>`;
        } else if (data.person_count > 0 || data.person_in_roi) {
            const ppeTag = (data.costume_status && data.costume_status !== 'N/A') ? data.costume_status : 'Intruder';
            workerEl.innerHTML = `<span class="badge bg-danger text-white"><i class="fa-solid fa-triangle-exclamation me-1"></i>${ppeTag}</span>`;
        } else {
            workerEl.innerHTML = `<span class="text-muted"><i class="fa-solid fa-minus me-1"></i>None</span>`;
        }
    }

    // 2. Risk Meter Pointer Position
    const riskLevel = (data.risk_level || 'Safe').toUpperCase();
    updateRiskIndicator(riskLevel);

    // 3. AI Pipeline Step Highlighting
    updatePipelineFlow(data);

    // 4. Alert message feed
    if (data.alert_message && riskLevel !== lastLoggedRisk && !riskLevel.includes('STANDBY')) {
        addAlertFeedItem(data);
        lastLoggedRisk = riskLevel;
    }

    // 5. Audio Alarm: ONLY sound when person is in ROI AND train is approaching!
    const personInRoi = Boolean(data.person_in_roi || data.unauthorized_in_roi);
    const trainsDetected = Number(data.train_count || 0) > 0;
    const trainPresent = Boolean(data.train_present);
    const riskUpper = riskLevel.toUpperCase();
    const alertUpper = (data.alert_status || '').toUpperCase();
    const isTrainApproaching = trainsDetected || trainPresent || 
        riskUpper.includes('TRAIN APPROACHING') || 
        riskUpper.includes('APPROACHING TRAIN') || 
        riskUpper.includes('COLLISION RISK') ||
        alertUpper.includes('TRAIN') ||
        (Number(data.train_speed || 0) > 0 && Number(data.distance || 0) > 0);

    const shouldAlarm = personInRoi && isTrainApproaching;
    handleDashboardAudioAlert(data, shouldAlarm);
}

function updateRiskIndicator(riskStr) {
    const pointer = document.getElementById('riskPointer');
    const badge = document.getElementById('telemetryRiskBadge');
    if (!pointer) return;

    let pos = '12%';
    let color = '#10B981';
    let text = 'SAFE';
    let badgeClass = 'badge-risk-safe';

    if (riskStr.includes('CRITICAL')) {
        pos = '88%';
        color = '#DC2626';
        text = 'CRITICAL';
        badgeClass = 'badge-risk-critical';
    } else if (riskStr.includes('HIGH')) {
        pos = '63%';
        color = '#EA580C';
        text = 'HIGH RISK';
        badgeClass = 'badge-risk-high';
    } else if (riskStr.includes('WARNING') || riskStr.includes('WARN')) {
        pos = '38%';
        color = '#F59E0B';
        text = 'WARNING';
        badgeClass = 'badge-risk-warning';
    } else {
        pos = '12%';
        color = '#10B981';
        text = 'SAFE';
        badgeClass = 'badge-risk-safe';
    }

    pointer.style.left = pos;
    pointer.style.borderColor = color;

    if (badge) {
        badge.className = `badge-risk ${badgeClass}`;
        badge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${text}`;
    }
}

function updatePipelineFlow(data) {
    const nodePerson = document.getElementById('pipeNodePerson');
    const nodeRoi = document.getElementById('pipeNodeRoi');
    const nodeVerify = document.getElementById('pipeNodeVerify');
    const nodeRisk = document.getElementById('pipeNodeRisk');
    const nodeAlert = document.getElementById('pipeNodeAlert');

    if (!nodePerson) return;

    const hasPerson = (data.person_count || 0) > 0;
    const inRoi = Boolean(data.person_in_roi);
    const isAuth = data.verification_status === 'AUTHORIZED';
    const isCritical = (data.risk_level || '').toUpperCase().includes('CRITICAL');

    setNodeState(nodePerson, hasPerson ? 'completed' : 'waiting', hasPerson ? 'Detected' : 'Waiting');
    setNodeState(nodeRoi, inRoi ? 'completed' : hasPerson ? 'processing' : 'waiting', inRoi ? 'Inside ROI' : 'Clear');
    setNodeState(nodeVerify, hasPerson ? (isAuth ? 'completed' : 'processing') : 'waiting', isAuth ? 'Authorized' : hasPerson ? 'Unverified' : 'Idle');
    setNodeState(nodeRisk, inRoi ? 'completed' : 'waiting', data.risk_level || 'Safe');
    setNodeState(nodeAlert, isCritical ? 'processing' : 'waiting', isCritical ? 'Dispatched' : 'Nominal');
}

function setNodeState(el, stateClass, statusText) {
    if (!el) return;
    el.classList.remove('completed', 'processing', 'waiting');
    el.classList.add(stateClass);
    const statEl = el.querySelector('.pipeline-node-status');
    if (statEl) statEl.textContent = statusText;
}

function addAlertFeedItem(data) {
    const list = document.getElementById('liveAlertFeed');
    if (!list) return;

    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    const risk = (data.risk_level || 'Safe').toUpperCase();
    let riskClass = 'alert-safe';
    let icon = 'fa-circle-check text-success';

    if (risk.includes('CRITICAL')) {
        riskClass = 'alert-critical';
        icon = 'fa-triangle-exclamation text-danger';
    } else if (risk.includes('HIGH')) {
        riskClass = 'alert-high';
        icon = 'fa-circle-exclamation text-warning';
    } else if (risk.includes('WARNING')) {
        riskClass = 'alert-warning';
        icon = 'fa-bell text-warning';
    }

    const item = document.createElement('div');
    item.className = `alert-feed-item ${riskClass}`;
    item.innerHTML = `
        <div class="alert-feed-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="alert-feed-content">
            <div class="alert-feed-title">
                <span>${risk} ALERT - CAM-01</span>
                <span class="alert-feed-time">${timeStr}</span>
            </div>
            <div class="alert-feed-desc">${data.alert_message || 'Telemetry state transition.'}</div>
        </div>
    `;

    list.insertBefore(item, list.firstChild);
    // Keep max 12 items
    while (list.children.length > 12) {
        list.removeChild(list.lastChild);
    }
}

/* --------------------------------------------------------------------------
   5. Search Filter Bar
   -------------------------------------------------------------------------- */
function initSearchFilter() {
    const searchInput = document.getElementById('globalSearchInput');
    if (!searchInput) return;

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim().toLowerCase();
            if (!query) return;
            if (query.includes('work') || query.includes('emp')) {
                window.location.href = '/workers';
            } else if (query.includes('inc') || query.includes('log') || query.includes('alert')) {
                window.location.href = '/incidents';
            } else if (query.includes('analytic') || query.includes('chart') || query.includes('stat')) {
                window.location.href = '/analytics';
            } else if (query.includes('setting') || query.includes('roi')) {
                window.location.href = '/settings';
            } else {
                window.location.href = '/monitoring';
            }
        }
    });
}

/* --------------------------------------------------------------------------
   6. Dynamic Topbar Safety Notifications
   -------------------------------------------------------------------------- */
async function initTopbarNotifications() {
    const badge = document.getElementById('topbarNotifBadge');
    const countText = document.getElementById('topbarNotifCountText');
    const list = document.getElementById('topbarNotifList');
    if (!badge || !list) return;

    try {
        const res = await fetch('/api/logs');
        if (!res.ok) return;
        const logs = await res.json();

        // Filter alerts with warning/critical or recent
        const activeAlerts = logs.filter(row => {
            const risk = (row[10] || '').toUpperCase();
            return !risk.includes('SAFE') && !risk.includes('STANDBY');
        });

        const count = activeAlerts.length;
        badge.textContent = count > 99 ? '99+' : count;
        if (countText) countText.textContent = `${count} Alert${count === 1 ? '' : 's'}`;

        if (count === 0) {
            badge.style.display = 'none';
            list.innerHTML = `
                <li class="p-3 text-center text-muted small">
                    <i class="fa-solid fa-circle-check text-success me-1"></i> All sectors nominal. No active alerts.
                </li>
            `;
            return;
        }

        badge.style.display = 'flex';
        // Show up to 4 most recent
        const topRecent = activeAlerts.slice(0, 4);
        list.innerHTML = topRecent.map(row => {
            const id = row[0];
            const time = row[1];
            const cam = row[2];
            const risk = (row[10] || 'Safe').toUpperCase();
            const dotClass = risk.includes('CRITICAL') ? 'dot-critical' : 'dot-warning';
            const textClass = risk.includes('CRITICAL') ? 'text-danger' : 'text-warning';

            return `
                <li class="p-2 border-bottom">
                    <a class="dropdown-item p-1" href="/incidents">
                        <div class="d-flex align-items-start gap-2">
                            <span class="status-dot ${dotClass} mt-1"></span>
                            <div>
                                <div class="fw-bold small ${textClass}">${risk}: ${cam} Intrusion</div>
                                <div class="text-muted font-mono" style="font-size: 11px;">${time} • INC-${String(id).padStart(5, '0')}</div>
                            </div>
                        </div>
                    </a>
                </li>
            `;
        }).join('');
    } catch (e) {
        console.warn('Notification fetch notice:', e);
    }
}

/* --------------------------------------------------------------------------
   Dashboard Web Audio API - Cinema-Grade Modern Railway Emergency Siren
   Rich multi-harmonic frequency-swept emergency siren with sub-bass acoustic warmth
   -------------------------------------------------------------------------- */
let dashAudioCtx = null;
let isDashSoundEnabled = true;
let isDashAlarmPlaying = false;
let dashSirenOscMain = null;
let dashSirenOscSub = null;
let dashSirenOscFifth = null;
let dashSirenGain = null;
let dashSweepInterval = null;
let dashTestTimeout = null;

function getDashAudioContext() {
    if (!dashAudioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            dashAudioCtx = new AudioContextClass();
        }
    }
    if (dashAudioCtx && dashAudioCtx.state === 'suspended') {
        dashAudioCtx.resume();
    }
    return dashAudioCtx;
}

document.addEventListener('click', () => {
    getDashAudioContext();
}, { once: false });

/**
 * Starts the rich, multi-oscillator emergency railway safety siren on Dashboard
 */
function startDashboardAlarm() {
    if (!isDashSoundEnabled || isDashAlarmPlaying) return;

    try {
        const ctx = getDashAudioContext();
        if (!ctx) return;

        isDashAlarmPlaying = true;
        const now = ctx.currentTime;

        // 1. Resonant Lowpass Filter
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2200, now);
        filter.Q.setValueAtTime(2.5, now);

        // 2. Master Gain Node with smooth fade-in
        dashSirenGain = ctx.createGain();
        dashSirenGain.gain.setValueAtTime(0.001, now);
        dashSirenGain.gain.linearRampToValueAtTime(0.22, now + 0.08);

        // 3. Oscillators
        dashSirenOscMain = ctx.createOscillator();
        dashSirenOscMain.type = 'sawtooth';
        dashSirenOscMain.frequency.setValueAtTime(587, now);

        dashSirenOscSub = ctx.createOscillator();
        dashSirenOscSub.type = 'sine';
        dashSirenOscSub.frequency.setValueAtTime(293, now);

        dashSirenOscFifth = ctx.createOscillator();
        dashSirenOscFifth.type = 'triangle';
        dashSirenOscFifth.frequency.setValueAtTime(880, now);

        // Routing
        dashSirenOscMain.connect(filter);
        dashSirenOscSub.connect(filter);
        dashSirenOscFifth.connect(filter);
        filter.connect(dashSirenGain);
        dashSirenGain.connect(ctx.destination);

        dashSirenOscMain.start(now);
        dashSirenOscSub.start(now);
        dashSirenOscFifth.start(now);

        // Sweep loop every 280ms
        let sweepHigh = false;
        dashSweepInterval = setInterval(() => {
            if (!isDashAlarmPlaying || !dashAudioCtx) return;
            const t = dashAudioCtx.currentTime;
            sweepHigh = !sweepHigh;

            const freqMain = sweepHigh ? 880 : 587;
            const freqSub = sweepHigh ? 440 : 293;
            const freqFifth = sweepHigh ? 1320 : 880;

            dashSirenOscMain.frequency.cancelScheduledValues(t);
            dashSirenOscSub.frequency.cancelScheduledValues(t);
            dashSirenOscFifth.frequency.cancelScheduledValues(t);

            dashSirenOscMain.frequency.exponentialRampToValueAtTime(freqMain, t + 0.24);
            dashSirenOscSub.frequency.exponentialRampToValueAtTime(freqSub, t + 0.24);
            dashSirenOscFifth.frequency.exponentialRampToValueAtTime(freqFifth, t + 0.24);
        }, 280);

        console.log('🚨 Dashboard Emergency Warning Siren Active');
    } catch (err) {
        console.warn('Dashboard audio error:', err);
    }
}

function stopDashboardAlarm() {
    if (!isDashAlarmPlaying) return;

    try {
        if (dashSweepInterval) {
            clearInterval(dashSweepInterval);
            dashSweepInterval = null;
        }

        if (dashSirenGain && dashAudioCtx) {
            const now = dashAudioCtx.currentTime;
            dashSirenGain.gain.cancelScheduledValues(now);
            dashSirenGain.gain.linearRampToValueAtTime(0.0001, now + 0.08);
        }

        setTimeout(() => {
            if (dashSirenOscMain) {
                try { dashSirenOscMain.stop(); dashSirenOscMain.disconnect(); } catch (e) {}
                dashSirenOscMain = null;
            }
            if (dashSirenOscSub) {
                try { dashSirenOscSub.stop(); dashSirenOscSub.disconnect(); } catch (e) {}
                dashSirenOscSub = null;
            }
            if (dashSirenOscFifth) {
                try { dashSirenOscFifth.stop(); dashSirenOscFifth.disconnect(); } catch (e) {}
                dashSirenOscFifth = null;
            }
            if (dashSirenGain) {
                try { dashSirenGain.disconnect(); } catch (e) {}
                dashSirenGain = null;
            }
        }, 90);
    } catch (e) {
        console.warn('Error stopping dashboard siren:', e);
    } finally {
        isDashAlarmPlaying = false;
    }
}

function handleDashboardAudioAlert(data, shouldAlarm) {
    if (dashTestTimeout) return;
    // Siren ONLY sounds when BOTH person is in ROI AND train is approaching!
    if (shouldAlarm && isDashSoundEnabled) {
        startDashboardAlarm();
    } else {
        stopDashboardAlarm();
    }
}

function initDashboardAudioControls() {
    const btnTest = document.getElementById('btnTestAlarmDash');
    const btnToggle = document.getElementById('btnToggleSoundDash');

    if (btnTest) {
        btnTest.addEventListener('click', () => {
            getDashAudioContext();
            stopDashboardAlarm();
            if (dashTestTimeout) clearTimeout(dashTestTimeout);

            btnTest.classList.remove('btn-outline-danger');
            btnTest.classList.add('btn-danger');
            btnTest.innerHTML = `<i class="fa-solid fa-volume-high fa-beat me-1"></i> Testing Siren...`;

            const wasEnabled = isDashSoundEnabled;
            isDashSoundEnabled = true;
            startDashboardAlarm();

            dashTestTimeout = setTimeout(() => {
                stopDashboardAlarm();
                isDashSoundEnabled = wasEnabled;
                btnTest.classList.remove('btn-danger');
                btnTest.classList.add('btn-outline-danger');
                btnTest.innerHTML = `<i class="fa-solid fa-volume-high me-1"></i> Test Alarm`;
                dashTestTimeout = null;
            }, 3200);
        });
    }

    if (btnToggle) {
        btnToggle.addEventListener('click', () => {
            getDashAudioContext();
            isDashSoundEnabled = !isDashSoundEnabled;
            if (!isDashSoundEnabled) {
                stopDashboardAlarm();
                btnToggle.classList.remove('btn-outline-primary');
                btnToggle.classList.add('btn-outline-secondary');
                btnToggle.innerHTML = `<i class="fa-solid fa-bell-slash me-1"></i> Sound: OFF`;
            } else {
                btnToggle.classList.remove('btn-outline-secondary');
                btnToggle.classList.add('btn-outline-primary');
                btnToggle.innerHTML = `<i class="fa-solid fa-bell me-1"></i> Sound: ON`;
            }
        });
    }
}

