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
    const resultBox = document.getElementById('testFaceResultBox');

    if (testInput && testPreview) {
        testInput.addEventListener('change', () => {
            const file = testInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    testPreview.src = e.target.result;
                    testPreview.classList.remove('d-none');
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

            const formData = new FormData();
            formData.append('face_image', file);

            try {
                const res = await fetch('/api/verify_face_test', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();

                if (resultBox) {
                    resultBox.classList.remove('d-none');
                    if (data.is_authorized) {
                        resultBox.className = 'alert alert-success mt-3 py-3';
                        resultBox.innerHTML = `
                            <div class="d-flex align-items-center gap-3">
                                <i class="fa-solid fa-circle-check fs-2 text-success"></i>
                                <div>
                                    <h6 class="fw-bold mb-1 text-success">FACE MATCH: ✓ MATCHED</h6>
                                    <div class="small">Worker ID: <strong>${data.best_worker || 'EMP_101'}</strong></div>
                                    <div class="small">Verification Status: <span class="badge bg-success">AUTHORIZED RAILWAY WORKER</span></div>
                                </div>
                            </div>
                        `;
                    } else if (data.confidence && data.confidence > 0.35 && data.confidence < 0.6) {
                        resultBox.className = 'alert alert-warning mt-3 py-3';
                        resultBox.innerHTML = `
                            <div class="d-flex align-items-center gap-3">
                                <i class="fa-solid fa-triangle-exclamation fs-2 text-warning"></i>
                                <div>
                                    <h6 class="fw-bold mb-1 text-warning">VERIFICATION UNCERTAIN</h6>
                                    <div class="small text-muted">Facial features partially obscured or low confidence (${(data.confidence * 100).toFixed(1)}%). Requires secondary ID check.</div>
                                    <div class="small mt-1"><span class="badge bg-warning text-dark">ACTION: MANUAL VERIFY</span></div>
                                </div>
                            </div>
                        `;
                    } else {
                        resultBox.className = 'alert alert-danger mt-3 py-3';
                        resultBox.innerHTML = `
                            <div class="d-flex align-items-center gap-3">
                                <i class="fa-solid fa-circle-xmark fs-2 text-danger"></i>
                                <div>
                                    <h6 class="fw-bold mb-1 text-danger">✕ NOT VERIFIED: UNAUTHORIZED PERSON</h6>
                                    <div class="small">No authorized identity matches found in employee database.</div>
                                    <div class="small mt-1"><span class="badge bg-danger">FLAGGED INTRUSION</span></div>
                                </div>
                            </div>
                        `;
                    }
                }
            } catch (err) {
                alert('Verification service error.');
            } finally {
                testBtn.disabled = false;
                testBtn.innerHTML = `<i class="fa-solid fa-id-card-clip me-1"></i> Verify Captured Face`;
            }
        });
    }
}
