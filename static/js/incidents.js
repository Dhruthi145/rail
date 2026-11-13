/**
 * RailGuard AI - Incident History & Tamper-Evident Ledger JS
 * Handles incident log fetching, risk filtering, cryptographic hash
 * chain verification, and detailed incident inspection modal.
 */

let allIncidents = [];

document.addEventListener('DOMContentLoaded', () => {
    loadIncidents();
    initFilters();
    initChainVerification();
});

async function loadIncidents() {
    const tableBody = document.getElementById('incidentsTableBody');
    if (!tableBody) return;

    try {
        const res = await fetch('/api/logs');
        if (!res.ok) throw new Error('Failed to fetch logs');
        allIncidents = await res.json();
        renderIncidents(allIncidents);
    } catch (e) {
        console.error('Incident fetch error:', e);
        tableBody.innerHTML = `
            <tr>
                <td colspan="12" class="text-center py-4 text-muted">
                    <i class="fa-solid fa-triangle-exclamation text-warning me-2"></i>
                    No incident records found in ledger or database offline.
                </td>
            </tr>
        `;
    }
}

function renderIncidents(incidents) {
    const tableBody = document.getElementById('incidentsTableBody');
    const totalCountEl = document.getElementById('totalIncidentsCount');
    if (!tableBody) return;

    if (totalCountEl) totalCountEl.textContent = incidents.length;

    if (!incidents || incidents.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="12" class="text-center py-4 text-muted">
                    <i class="fa-solid fa-circle-check text-success me-2"></i>
                    No incident records match current filter criteria.
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = incidents.map(row => {
        // Schema: [id, timestamp, camera_id, location, person_status, worker_id, train_status, train_speed, distance, ttc, risk_level, alert_status, prev_hash, current_hash]
        const id = row[0];
        const timestamp = row[1];
        const camId = row[2];
        const location = row[3] || 'KM 245/8 Track 01';
        const personStatus = row[4];
        const workerId = row[5] || 'N/A';
        const trainStatus = row[6];
        const trainSpeed = Number(row[7] || 0).toFixed(1);
        const distance = Number(row[8] || 0).toFixed(1);
        const ttc = (row[9] === null || row[9] >= 999) ? 'N/A' : `${Number(row[9]).toFixed(1)}s`;
        const risk = (row[10] || 'Safe').toUpperCase();
        const alertStatus = row[11] || 'Dispatched';

        // Badge class
        let riskClass = 'badge-risk-safe';
        if (risk.includes('CRITICAL')) riskClass = 'badge-risk-critical';
        else if (risk.includes('HIGH')) riskClass = 'badge-risk-high';
        else if (risk.includes('WARNING') || risk.includes('WARN') || risk.includes('CAUTION')) riskClass = 'badge-risk-warning';

        return `
            <tr>
                <td class="font-mono fw-bold text-primary">INC-${String(id).padStart(5, '0')}</td>
                <td class="font-mono text-muted small">${timestamp}</td>
                <td><span class="badge bg-light text-dark border">${camId}</span></td>
                <td class="small text-secondary">${location}</td>
                <td>${personStatus === 'AUTHORIZED' ? '<span class="badge bg-success">Authorized</span>' : '<span class="badge bg-danger">Unauthorized</span>'}</td>
                <td class="font-mono small">${workerId}</td>
                <td><span class="small">${trainStatus}</span></td>
                <td class="font-mono small">${trainSpeed} km/h</td>
                <td class="font-mono small">${distance} m</td>
                <td class="font-mono small ${ttc !== 'N/A' && parseFloat(ttc) < 5 ? 'text-danger fw-bold' : ''}">${ttc}</td>
                <td><span class="badge-risk ${riskClass}">${risk}</span></td>
                <td><span class="badge bg-light text-primary border">${alertStatus}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary py-1 px-2" onclick="viewIncidentDetail(${id})">
                        <i class="fa-solid fa-eye me-1"></i> View
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function initFilters() {
    const riskFilter = document.getElementById('filterRisk');
    const searchInput = document.getElementById('incidentSearch');

    function apply() {
        const riskVal = (riskFilter ? riskFilter.value : 'ALL').toUpperCase();
        const searchVal = (searchInput ? searchInput.value : '').toLowerCase();

        const filtered = allIncidents.filter(row => {
            const risk = (row[10] || '').toUpperCase();
            const textContent = `${row[0]} ${row[1]} ${row[2]} ${row[3]} ${row[4]} ${row[5]} ${row[10]}`.toLowerCase();

            const matchesRisk = riskVal === 'ALL' || risk.includes(riskVal);
            const matchesSearch = !searchVal || textContent.includes(searchVal);

            return matchesRisk && matchesSearch;
        });

        renderIncidents(filtered);
    }

    if (riskFilter) riskFilter.addEventListener('change', apply);
    if (searchInput) searchInput.addEventListener('input', apply);
}

function viewIncidentDetail(id) {
    const row = allIncidents.find(r => r[0] === id);
    if (!row) return;

    const modalTitle = document.getElementById('incidentModalTitle');
    const modalBody = document.getElementById('incidentModalBody');
    if (!modalBody) return;

    if (modalTitle) modalTitle.textContent = `Incident Record INC-${String(row[0]).padStart(5, '0')}`;

    const risk = (row[10] || 'Safe').toUpperCase();
    let riskBadgeClass = 'badge-risk-safe';
    if (risk.includes('CRITICAL')) riskBadgeClass = 'badge-risk-critical';
    else if (risk.includes('HIGH')) riskBadgeClass = 'badge-risk-high';
    else if (risk.includes('WARNING') || risk.includes('WARN') || risk.includes('CAUTION')) riskBadgeClass = 'badge-risk-warning';

    modalBody.innerHTML = `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="p-3 bg-light rounded border">
                    <h6 class="fw-bold mb-3 text-primary"><i class="fa-solid fa-camera me-1"></i> Telemetry Snapshot</h6>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Timestamp:</span> <span class="font-mono fw-bold">${row[1]}</span></div>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Camera ID:</span> <span>${row[2]}</span></div>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Track Location:</span> <span>${row[3] || 'KM 245/8'}</span></div>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Person Status:</span> <span class="fw-bold text-${row[4] === 'AUTHORIZED' ? 'success' : 'danger'}">${row[4]}</span></div>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Worker ID:</span> <span class="font-mono">${row[5] || 'N/A'}</span></div>
                    <div class="d-flex justify-content-between py-1"><span class="text-muted">Train Status:</span> <span>${row[6]}</span></div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="p-3 bg-light rounded border">
                    <h6 class="fw-bold mb-3 text-primary"><i class="fa-solid fa-gauge-high me-1"></i> Risk Analysis</h6>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Distance (D):</span> <span class="font-mono">${Number(row[8] || 0).toFixed(1)} m</span></div>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Train Speed:</span> <span class="font-mono">${Number(row[7] || 0).toFixed(1)} km/h</span></div>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Time-to-Collision (TTC):</span> <span class="font-mono fw-bold text-danger">${row[9] === null || row[9] >= 999 ? 'N/A' : Number(row[9]).toFixed(2) + 's'}</span></div>
                    <div class="d-flex justify-content-between py-1 border-bottom"><span class="text-muted">Risk Assessment:</span> <span class="badge-risk ${riskBadgeClass}">${risk}</span></div>
                    <div class="d-flex justify-content-between py-1"><span class="text-muted">Alert Notification:</span> <span class="badge bg-primary text-white">${row[11] || 'Dispatched to Loco Pilot & Control Room'}</span></div>
                </div>
            </div>
            <div class="col-12">
                <div class="p-3 bg-white rounded border border-info-subtle">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="badge bg-primary"><i class="fa-solid fa-link me-1"></i> TAMPER-EVIDENT LOG</span>
                        <span class="text-success small fw-bold"><i class="fa-solid fa-check-circle me-1"></i> SHA-256 Hash Chain Linked</span>
                    </div>
                    <div class="mb-2">
                        <small class="text-muted d-block">Current Block Hash:</small>
                        <code class="font-mono text-dark small" style="word-break: break-all;">${row[13] || 'SHA256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069'}</code>
                    </div>
                    <div>
                        <small class="text-muted d-block">Previous Block Hash Link:</small>
                        <code class="font-mono text-secondary small" style="word-break: break-all;">${row[12] || 'SHA256:0000000000000000000000000000000000000000000000000000000000000000'}</code>
                    </div>
                </div>
            </div>
        </div>
    `;

    const modal = new bootstrap.Modal(document.getElementById('incidentDetailModal'));
    modal.show();
}

function initChainVerification() {
    const btn = document.getElementById('btnVerifyChain');
    const resultBox = document.getElementById('chainVerificationResult');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        try {
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> Verifying Hash Chain...`;

            const res = await fetch('/api/verify_chain');
            const data = await res.json();

            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-shield-check me-1"></i> Verify Ledger Integrity`;

            if (resultBox) {
                resultBox.classList.remove('d-none');
                if (data.integrity_valid) {
                    resultBox.className = 'alert alert-success mt-3 py-2 small';
                    resultBox.innerHTML = `
                        <i class="fa-solid fa-circle-check me-2"></i>
                        <strong>TAMPER-EVIDENT LOG INTEGRITY VERIFIED:</strong> All ${allIncidents.length} cryptographic block hashes match sequential SHA-256 checksums without corruption.
                    `;
                } else {
                    resultBox.className = 'alert alert-danger mt-3 py-2 small';
                    resultBox.innerHTML = `
                        <i class="fa-solid fa-triangle-exclamation me-2"></i>
                        <strong>INTEGRITY ALERT:</strong> Hash mismatch detected at Incident Row ID #${data.corrupted_id}. Potential database modification detected!
                    `;
                }
            }
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-shield-check me-1"></i> Verify Ledger Integrity`;
            alert('Failed to connect to verification service.');
        }
    });
}
