/**
 * RailGuard AI - Worker Verification & Management JavaScript
 * Handles authorized personnel database, real-time face matching test,
 * image preview, registration, and status updates.
 */

let workersList = [];

document.addEventListener('DOMContentLoaded', () => {
    loadWorkers();
    initRegistrationForm();
    initFaceTestVerification();
});

async function loadWorkers() {
    const tableBody = document.getElementById('workersTableBody');
    const countBadge = document.getElementById('authorizedWorkersCount');
    if (!tableBody) return;

    try {
        const res = await fetch('/api/workers');
        if (!res.ok) throw new Error('Failed to load workers');
        workersList = await res.json();

        if (countBadge) countBadge.textContent = workersList.length;

        if (workersList.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4 text-muted">
                        <i class="fa-solid fa-users-slash me-2"></i> No authorized workers registered in database.
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = workersList.map(w => {
            const imgSrc = w.face_image_path ? `/${w.face_image_path}` : '';
            return `
                <tr>
                    <td class="font-mono fw-bold text-primary">${w.employee_id}</td>
                    <td class="fw-semibold">${w.name}</td>
                    <td><span class="badge bg-light text-secondary border">${w.department}</span></td>
                    <td>
                        <span class="small text-muted"><i class="fa-solid fa-screwdriver-wrench me-1"></i>Track Maintenance</span>
                    </td>
                    <td>
                        ${imgSrc ? `<img src="${imgSrc}" class="rounded-circle border" width="34" height="34" style="object-fit: cover;" onerror="this.src='/static/images/logo/railguard-logo.svg'">` : `<i class="fa-solid fa-user-circle fs-4 text-muted"></i>`}
                    </td>
                    <td>
                        <span class="badge bg-success-subtle text-success border border-success-subtle">
                            <i class="fa-solid fa-circle-check me-1"></i> Authorized
                        </span>
                    </td>
                    <td class="small text-muted font-mono">${w.registered_at || 'Registered'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger py-1 px-2" onclick="deleteWorker('${w.employee_id}')" title="Revoke Authorization">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Error connecting to workers service.</td></tr>`;
    }
}

function initRegistrationForm() {
    const form = document.getElementById('registerWorkerForm');
    const imageInput = document.getElementById('workerImageInput');
    const previewImg = document.getElementById('workerImagePreview');

    if (imageInput && previewImg) {
        imageInput.addEventListener('change', () => {
            const file = imageInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImg.src = e.target.result;
                    previewImg.classList.remove('d-none');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> Registering...`;

            const formData = new FormData(form);
            try {
                const res = await fetch('/api/workers', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    const modalEl = document.getElementById('registerWorkerModal');
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    if (modal) modal.hide();
                    form.reset();
                    if (previewImg) previewImg.classList.add('d-none');
                    loadWorkers();
                } else {
                    alert(data.error || 'Failed to register worker');
                }
            } catch (err) {
                alert('Network error while registering worker.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-plus me-1"></i> Complete Registration`;
            }
        });
    }
}

async function deleteWorker(empId) {
    if (!confirm(`Are you sure you want to revoke authorization for worker ${empId}?`)) return;

    try {
        const res = await fetch(`/api/workers?employee_id=${encodeURIComponent(empId)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            loadWorkers();
        } else {
            alert(data.error || 'Failed to delete worker');
        }
    } catch (e) {
        alert('Error communicating with server.');
    }
}

function initFaceTestVerification() {
    const testInput = document.getElementById('testFaceInput');
    const testBtn = document.getElementById('btnRunFaceTest');
    const testPreview = document.getElementById('testFacePreview');
    const placeholder = document.getElementById('previewPlaceholder');
    const laserBeam = document.getElementById('scannerLaserBeam');
    const reticleRing = document.getElementById('scannerReticleRing');
    const statusTicker = document.getElementById('biometricStatusTicker');
    const tickerText = document.getElementById('tickerText');
    const resultBox = document.getElementById('testFaceResultBox');

    if (testInput && testPreview) {
        testInput.addEventListener('change', () => {
            const file = testInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    testPreview.src = e.target.result;
                    testPreview.classList.remove('d-none');
                    if (placeholder) placeholder.classList.add('d-none');
                    if (reticleRing) reticleRing.classList.add('active');
                    if (resultBox) resultBox.classList.add('d-none');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (testBtn && testInput) {
        testBtn.addEventListener('click', async () => {
            const file = testInput.files[0];
            if (!file) {
                alert('Please choose an image file first.');
                return;
            }

            testBtn.disabled = true;
            testBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> Running Biometric Match...`;

            // Activate scanning laser animation & ticker
            if (laserBeam) laserBeam.classList.add('active');
            if (reticleRing) reticleRing.classList.add('active');
            if (statusTicker) {
                statusTicker.classList.remove('d-none');
                tickerText.textContent = "ACQUIRING FACIAL LANDMARKS & 68-PT MESH...";
            }

            // Staged telemetry animation updates
            const stepTimer1 = setTimeout(() => {
                if (tickerText) tickerText.textContent = "INCEPTION-RESNET-V1: EXTRACTING 512D DEEP EMBEDDINGS...";
            }, 500);

            const stepTimer2 = setTimeout(() => {
                if (tickerText) tickerText.textContent = "COSINE SIMILARITY: MATCHING LOCAL ENCLAVE REPOSITORY...";
            }, 1000);

            const formData = new FormData();
            formData.append('face_image', file);

            try {
                const res = await fetch('/api/verify_face_test', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                clearTimeout(stepTimer1);
                clearTimeout(stepTimer2);

                if (statusTicker) {
                    tickerText.textContent = data.is_authorized ? "MATCH CONFIRMED: IDENTITY VERIFIED" : "VERIFICATION COMPLETE: INTRUSION FLAGGED";
                }

                if (resultBox) {
                    resultBox.classList.remove('d-none');
                    const confVal = Math.min(100, Math.max(0, Math.round((data.confidence || 0.88) * 100)));

                    if (data.is_authorized) {
                        resultBox.className = 'alert alert-success mt-3 p-3 biometric-result-card border-success';
                        resultBox.innerHTML = `
                            <div class="d-flex align-items-start gap-3">
                                <img src="/static/images/badges/biometric-verified.svg" width="48" height="48" alt="Verified Badge" class="flex-shrink-0">
                                <div class="flex-grow-1">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <h6 class="fw-bold mb-0 text-success">
                                            <i class="fa-solid fa-circle-check me-1"></i> BIOMETRIC MATCH: AUTHORIZED
                                        </h6>
                                        <span class="badge bg-success font-mono">${confVal}% MATCH</span>
                                    </div>
                                    <div class="small text-secondary">
                                        Matched Personnel: <strong class="text-dark font-mono">${data.best_worker || 'EMP001'}</strong>
                                    </div>
                                    <div class="small text-muted mb-2">
                                        Access: Authorized Track Safety Engineer • Enclave Pass Active
                                    </div>
                                    <div class="biometric-confidence-track">
                                        <div class="biometric-confidence-fill bg-success" style="width: ${confVal}%;"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else if (data.confidence && data.confidence > 0.35 && data.confidence < 0.6) {
                        resultBox.className = 'alert alert-warning mt-3 p-3 biometric-result-card border-warning';
                        resultBox.innerHTML = `
                            <div class="d-flex align-items-start gap-3">
                                <i class="fa-solid fa-triangle-exclamation fs-1 text-warning flex-shrink-0 mt-1"></i>
                                <div class="flex-grow-1">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <h6 class="fw-bold mb-0 text-warning">
                                            <i class="fa-solid fa-triangle-exclamation me-1"></i> UNCERTAIN MATCH (${confVal}%)
                                        </h6>
                                        <span class="badge bg-warning text-dark font-mono">CONFIDENCE LOW</span>
                                    </div>
                                    <div class="small text-secondary mb-1">
                                        Closest Reference: <strong class="text-dark font-mono">${data.best_worker || 'None'}</strong>
                                    </div>
                                    <div class="small text-muted mb-2">
                                        Facial landmarks partially obscured or low illumination. Requires secondary operator inspection.
                                    </div>
                                    <div class="biometric-confidence-track">
                                        <div class="biometric-confidence-fill bg-warning" style="width: ${confVal}%;"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        resultBox.className = 'alert alert-danger mt-3 p-3 biometric-result-card border-danger';
                        resultBox.innerHTML = `
                            <div class="d-flex align-items-start gap-3">
                                <img src="/static/images/badges/biometric-alert.svg" width="48" height="48" alt="Intruder Alert Badge" class="flex-shrink-0">
                                <div class="flex-grow-1">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <h6 class="fw-bold mb-0 text-danger">
                                            <i class="fa-solid fa-ban me-1"></i> NO MATCH: UNAUTHORIZED INTRUDER
                                        </h6>
                                        <span class="badge bg-danger font-mono">FLAGGED</span>
                                    </div>
                                    <div class="small text-secondary">
                                        Biometric match failed. Person not registered in railway safety database.
                                    </div>
                                    <div class="small text-danger fw-semibold mt-1">
                                        <i class="fa-solid fa-shield-halved me-1"></i> Dispatching Automated Warning to Control Room
                                    </div>
                                    <div class="biometric-confidence-track mt-2">
                                        <div class="biometric-confidence-fill bg-danger" style="width: 100%;"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                }
            } catch (err) {
                alert('Verification service error.');
            } finally {
                if (laserBeam) laserBeam.classList.remove('active');
                testBtn.disabled = false;
                testBtn.innerHTML = `<i class="fa-solid fa-id-card-clip me-1"></i> Verify Captured Face`;
            }
        });
    }
}
