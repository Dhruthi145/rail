/**
 * RailGuard AI - Live CCTV Monitoring & HUD Canvas JavaScript
 * Handles video stream canvas rendering, polygon ROI projection,
 * real-time kinematic calculations update, and alert acknowledgments.
 */

document.addEventListener('DOMContentLoaded', () => {
    initLiveMonitoring();
    initAcknowledgeBtn();
    initHUDClock();
    initAudioControls();
});

let telemetryTimer = null;

function initLiveMonitoring() {
    pollMonitoringTelemetry();
    telemetryTimer = setInterval(pollMonitoringTelemetry, 1000);
}

function initHUDClock() {
    const hudTime = document.getElementById('hudLiveTimestamp');
    if (!hudTime) return;

    function updateHUD() {
        const now = new Date();
        const str = now.toLocaleTimeString('en-US', { hour12: false });
        const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
        hudTime.textContent = `${str}.${ms}`;
    }
    updateHUD();
    setInterval(updateHUD, 100);
}

async function pollMonitoringTelemetry() {
    try {
        const res = await fetch('/api/telemetry');
        if (!res.ok) return;
        const data = await res.json();
        renderMonitoringTelemetry(data);
    } catch (e) {
        console.warn('Live monitoring poll error:', e);
    }
}

function renderMonitoringTelemetry(data) {
    // 1. Detection Summary Values
    const pCountEl = document.getElementById('monPersonsCount');
    const tCountEl = document.getElementById('monTrainsCount');
    const distEl = document.getElementById('monDistance');
    const speedEl = document.getElementById('monSpeed');
    const ttcEl = document.getElementById('monTTC');
    const riskLevelEl = document.getElementById('monRiskLevel');
    const riskBadgeEl = document.getElementById('monRiskBadge');
    const activeAlertCard = document.getElementById('monActiveAlertCard');
    const alertMsgEl = document.getElementById('monAlertMessage');
    const alertDestinations = document.getElementById('monAlertDestinations');

    const persons = data.person_count || 0;
    const trains = data.train_count || 0;
    const distance = Number(data.distance || 0);
    const speed = Number(data.train_speed || 0);
    const ttc = data.ttc;
    const risk = (data.risk_level || 'Safe').toUpperCase();

    if (pCountEl) pCountEl.textContent = persons < 10 ? `0${persons}` : persons;
    if (tCountEl) tCountEl.textContent = trains < 10 ? `0${trains}` : trains;
    if (distEl) distEl.textContent = distance.toFixed(1);
    if (speedEl) speedEl.textContent = speed.toFixed(1);

    if (ttcEl) {
        if (ttc === 'N/A' || ttc === null || ttc >= 999) {
            ttcEl.textContent = '--';
            ttcEl.classList.remove('text-danger', 'fw-bold');
        } else {
            ttcEl.textContent = `${Number(ttc).toFixed(1)}s`;
            if (Number(ttc) < 5.0) {
                ttcEl.classList.add('text-danger', 'fw-bold');
            } else {
                ttcEl.classList.remove('text-danger');
            }
        }
    }

    // 2. Risk Level Styling
    let badgeClass = 'badge-risk-safe';
    let riskIcon = 'fa-shield-halved';
    let isCritical = false;

    if (risk.includes('CRITICAL')) {
        badgeClass = 'badge-risk-critical';
        riskIcon = 'fa-triangle-exclamation';
        isCritical = true;
    } else if (risk.includes('HIGH')) {
        badgeClass = 'badge-risk-high';
        riskIcon = 'fa-circle-exclamation';
    } else if (risk.includes('WARNING')) {
        badgeClass = 'badge-risk-warning';
        riskIcon = 'fa-bell';
    }

    if (riskBadgeEl) {
        riskBadgeEl.className = `badge-risk ${badgeClass}`;
        riskBadgeEl.innerHTML = `<i class="fa-solid ${riskIcon}"></i> ${risk}`;
    }
    if (riskLevelEl) {
        riskLevelEl.textContent = risk;
    }

    const workerVerifEl = document.getElementById('monWorkerVerification');
    if (workerVerifEl) {
        if (data.verification_status === 'AUTHORIZED') {
            workerVerifEl.innerHTML = `<span class="badge bg-success text-white"><i class="fa-solid fa-hard-hat me-1"></i>${data.worker_id || 'EMP001'} (PPE+Face OK)</span>`;
        } else if (data.person_count > 0 || data.person_in_roi) {
            const ppeTag = (data.costume_status && data.costume_status !== 'N/A') ? data.costume_status : 'Intruder';
            workerVerifEl.innerHTML = `<span class="badge bg-danger text-white"><i class="fa-solid fa-triangle-exclamation me-1"></i>${ppeTag}</span>`;
        } else {
            workerVerifEl.innerHTML = `<span class="text-muted small"><i class="fa-solid fa-minus me-1"></i>None</span>`;
        }
    }

    // 3. Active Alert Card Highlighting
    if (activeAlertCard) {
        if (isCritical) {
            activeAlertCard.classList.add('has-critical');
        } else {
            activeAlertCard.classList.remove('has-critical');
        }
    }

    if (alertMsgEl) {
        alertMsgEl.textContent = data.alert_message || (isCritical ? 'CRITICAL: Unauthorized person on restricted track!' : 'Normal Track Operations - Zone Clear');
    }

    // 4. Live Alert Feed Logging (Real-time feed sync)
    if (data.alert_message && risk !== lastMonLoggedRisk && !risk.includes('STANDBY')) {
        addMonitoringAlertFeedItem(data);
        lastMonLoggedRisk = risk;
    }

    // 5. Update Audio Alarm: ONLY sound when a person is in the ROI AND a train is approaching!
    const personInRoi = Boolean(data.person_in_roi || data.unauthorized_in_roi);
    const trainsDetected = Number(data.train_count || 0) > 0;
    const trainPresent = Boolean(data.train_present);
    const riskUpper = risk.toUpperCase();
    const alertUpper = (data.alert_status || '').toUpperCase();
    const isTrainApproaching = trainsDetected || trainPresent || 
        riskUpper.includes('TRAIN APPROACHING') || 
        riskUpper.includes('APPROACHING TRAIN') || 
        riskUpper.includes('COLLISION RISK') ||
        alertUpper.includes('TRAIN') ||
        (Number(data.train_speed || 0) > 0 && Number(data.distance || 0) > 0);

    // ONLY sound if PERSON IN ROI AND TRAIN IS APPROACHING
    const shouldAlarm = personInRoi && isTrainApproaching;
    handleAudioAlert(data, shouldAlarm);

    // 6. Clean Canvas Update
    drawMonitoringCanvasOverlay(data);
}

let lastMonLoggedRisk = null;

function addMonitoringAlertFeedItem(data) {
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
    } else if (risk.includes('WARNING') || risk.includes('WARN')) {
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
    while (list.children.length > 12) {
        list.removeChild(list.lastChild);
    }
}

function drawMonitoringCanvasOverlay(data) {
    const canvas = document.getElementById('monitoringCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Synchronize canvas coordinate dimensions with display
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }

    // Keep camera viewport clear and unobstructed
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* --------------------------------------------------------------------------
   Web Audio API - Cinema-Grade Modern Railway Emergency Siren
   Rich multi-harmonic frequency-swept emergency siren with sub-bass acoustic warmth
   -------------------------------------------------------------------------- */
let audioCtx = null;
let isSoundEnabled = true;
let isAlarmPlaying = false;
let sirenOscMain = null;
let sirenOscSub = null;
let sirenOscFifth = null;
let sirenGain = null;
let sirenSweepInterval = null;
let testTimeout = null;

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

// Ensure AudioContext is unlocked upon first user interaction
document.addEventListener('click', () => {
    getAudioContext();
}, { once: false });

/**
 * Starts the rich, multi-oscillator emergency railway safety siren
 * Features: 580Hz-880Hz primary sawtooth sweep, 290Hz sub-bass warmth,
 * 870Hz harmonic fifth overtone, and resonant 2200Hz acoustic lowpass filter.
 */
function startAlarmSiren() {
    if (!isSoundEnabled || isAlarmPlaying) return;

    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        isAlarmPlaying = true;
        const now = ctx.currentTime;

        // 1. Resonant Acoustic Low-Pass Filter (eliminates harsh fizz, produces warm megaphone horn acoustic)
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2200, now);
        filter.Q.setValueAtTime(2.5, now);

        // 2. Master Gain Node with smooth fade-in
        sirenGain = ctx.createGain();
        sirenGain.gain.setValueAtTime(0.001, now);
        sirenGain.gain.linearRampToValueAtTime(0.22, now + 0.08);

        // 3. Oscillator 1: Primary Siren Lead (Sawtooth for sharp penetrating alarm presence)
        sirenOscMain = ctx.createOscillator();
        sirenOscMain.type = 'sawtooth';
        sirenOscMain.frequency.setValueAtTime(587, now);

        // 4. Oscillator 2: Sub-Bass Foundation (Sine wave for deep acoustic body & weight)
        sirenOscSub = ctx.createOscillator();
        sirenOscSub.type = 'sine';
        sirenOscSub.frequency.setValueAtTime(293, now);

        // 5. Oscillator 3: Harmonic Fifth (Triangle wave for rich chordal depth)
        sirenOscFifth = ctx.createOscillator();
        sirenOscFifth.type = 'triangle';
        sirenOscFifth.frequency.setValueAtTime(880, now);

        // Routing
        sirenOscMain.connect(filter);
        sirenOscSub.connect(filter);
        sirenOscFifth.connect(filter);
        filter.connect(sirenGain);
        sirenGain.connect(ctx.destination);

        sirenOscMain.start(now);
        sirenOscSub.start(now);
        sirenOscFifth.start(now);

        // 6. Smooth Urgent Siren Frequency Sweep (Alternates between 587Hz and 880Hz every 280ms)
        let sweepHigh = false;
        sirenSweepInterval = setInterval(() => {
            if (!isAlarmPlaying || !audioCtx) return;
            const t = audioCtx.currentTime;
            sweepHigh = !sweepHigh;

            const freqMain = sweepHigh ? 880 : 587;
            const freqSub = sweepHigh ? 440 : 293;
            const freqFifth = sweepHigh ? 1320 : 880;

            sirenOscMain.frequency.cancelScheduledValues(t);
            sirenOscSub.frequency.cancelScheduledValues(t);
            sirenOscFifth.frequency.cancelScheduledValues(t);

            sirenOscMain.frequency.exponentialRampToValueAtTime(freqMain, t + 0.24);
            sirenOscSub.frequency.exponentialRampToValueAtTime(freqSub, t + 0.24);
            sirenOscFifth.frequency.exponentialRampToValueAtTime(freqFifth, t + 0.24);
        }, 280);

        console.log('🚨 RailGuard Emergency Warning Siren ACTIVE [Train Approaching + Track Occupant]');
    } catch (err) {
        console.warn('Audio alert start error:', err);
    }
}

function stopAlarmSiren() {
    if (!isAlarmPlaying) return;

    try {
        if (sirenSweepInterval) {
            clearInterval(sirenSweepInterval);
            sirenSweepInterval = null;
        }

        if (sirenGain && audioCtx) {
            const now = audioCtx.currentTime;
            sirenGain.gain.cancelScheduledValues(now);
            sirenGain.gain.linearRampToValueAtTime(0.0001, now + 0.08);
        }

        setTimeout(() => {
            if (sirenOscMain) {
                try { sirenOscMain.stop(); sirenOscMain.disconnect(); } catch (e) {}
                sirenOscMain = null;
            }
            if (sirenOscSub) {
                try { sirenOscSub.stop(); sirenOscSub.disconnect(); } catch (e) {}
                sirenOscSub = null;
            }
            if (sirenOscFifth) {
                try { sirenOscFifth.stop(); sirenOscFifth.disconnect(); } catch (e) {}
                sirenOscFifth = null;
            }
            if (sirenGain) {
                try { sirenGain.disconnect(); } catch (e) {}
                sirenGain = null;
            }
        }, 90);
    } catch (e) {
        console.warn('Error stopping siren:', e);
    } finally {
        isAlarmPlaying = false;
    }
}

function handleAudioAlert(data, shouldAlarm) {
    if (testTimeout) return; // Don't override manual sound test

    // Siren ONLY sounds when BOTH person is in ROI AND train is approaching!
    if (shouldAlarm && isSoundEnabled) {
        startAlarmSiren();
    } else {
        stopAlarmSiren();
    }
}

function initAudioControls() {
    const btnTest = document.getElementById('btnTestAlarm');
    const btnToggle = document.getElementById('btnToggleSound');

    if (btnTest) {
        btnTest.addEventListener('click', () => {
            getAudioContext();
            stopAlarmSiren();
            if (testTimeout) clearTimeout(testTimeout);

            btnTest.classList.remove('btn-outline-danger');
            btnTest.classList.add('btn-danger');
            btnTest.innerHTML = `<i class="fa-solid fa-volume-high fa-beat me-1"></i> Testing Siren...`;

            // Start alarm test with new siren
            const wasEnabled = isSoundEnabled;
            isSoundEnabled = true;
            startAlarmSiren();

            testTimeout = setTimeout(() => {
                stopAlarmSiren();
                isSoundEnabled = wasEnabled;
                btnTest.classList.remove('btn-danger');
                btnTest.classList.add('btn-outline-danger');
                btnTest.innerHTML = `<i class="fa-solid fa-volume-high me-1"></i> Test Alarm Sound`;
                testTimeout = null;
            }, 3200);
        });
    }

    if (btnToggle) {
        btnToggle.addEventListener('click', () => {
            getAudioContext();
            isSoundEnabled = !isSoundEnabled;
            if (!isSoundEnabled) {
                stopAlarmSiren();
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

function initAcknowledgeBtn() {
    const ackBtn = document.getElementById('btnAcknowledgeAlert');
    if (!ackBtn) return;

    ackBtn.addEventListener('click', async () => {
        try {
            stopAlarmSiren(); // Instantly silence alarm on user acknowledgment
            ackBtn.disabled = true;
            ackBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> Acknowledging...`;

            const res = await fetch('/api/acknowledge-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alert_id: 'CURRENT_SURVEILLANCE' })
            });

            const resData = await res.json();
            if (resData.success) {
                ackBtn.className = 'btn btn-success btn-sm';
                ackBtn.innerHTML = `<i class="fa-solid fa-check me-1"></i> Acknowledged (${resData.timestamp || 'Now'})`;
                setTimeout(() => {
                    ackBtn.disabled = false;
                    ackBtn.className = 'btn btn-rail-primary btn-sm';
                    ackBtn.innerHTML = `<i class="fa-solid fa-check-double me-1"></i> Acknowledge Alert`;
                }, 4000);
            }
        } catch (e) {
            console.error(e);
            ackBtn.disabled = false;
            ackBtn.innerHTML = `<i class="fa-solid fa-check-double me-1"></i> Acknowledge Alert`;
        }
    });
}
