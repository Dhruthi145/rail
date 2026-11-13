/**
 * RailGuard AI - Settings & Interactive ROI Calibration Canvas JS
 * Allows drag-and-drop tuning of 4-point polygon ROI over railway track CCTV,
 * live coordinate calculation, threshold configuration, and REST API sync.
 */

let roiPoints = [
    { x: 120, y: 180, label: 'P1' },
    { x: 520, y: 180, label: 'P2' },
    { x: 600, y: 440, label: 'P3' },
    { x: 40, y: 440, label: 'P4' }
];

let draggedPointIndex = null;
const POINT_RADIUS = 10;
const CANVAS_NATIVE_WIDTH = 640;
const CANVAS_NATIVE_HEIGHT = 480;

document.addEventListener('DOMContentLoaded', () => {
    initROICanvas();
    initSettingsForms();
    fetchCurrentROI();
});

async function fetchCurrentROI() {
    try {
        const res = await fetch('/api/telemetry');
        if (!res.ok) return;
        const data = await res.json();
        if (data.roi_coords && Array.isArray(data.roi_coords) && data.roi_coords.length >= 4) {
            roiPoints = [
                { x: data.roi_coords[0][0], y: data.roi_coords[0][1], label: 'P1' },
                { x: data.roi_coords[1][0], y: data.roi_coords[1][1], label: 'P2' },
                { x: data.roi_coords[2][0], y: data.roi_coords[2][1], label: 'P3' },
                { x: data.roi_coords[3][0], y: data.roi_coords[3][1], label: 'P4' }
            ];
            drawROICanvas();
            updateCoordinateBadges();
        }
    } catch (e) {
        console.warn('ROI initial fetch note:', e);
    }
}

function initROICanvas() {
    const canvas = document.getElementById('roiCalibrationCanvas');
    if (!canvas) return;

    canvas.width = CANVAS_NATIVE_WIDTH;
    canvas.height = CANVAS_NATIVE_HEIGHT;

    drawROICanvas();
    updateCoordinateBadges();

    // Mouse & Touch Drag Handlers
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        for (let i = 0; i < roiPoints.length; i++) {
            const dx = mouseX - roiPoints[i].x;
            const dy = mouseY - roiPoints[i].y;
            if (Math.hypot(dx, dy) <= POINT_RADIUS * 1.5) {
                draggedPointIndex = i;
                break;
            }
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (draggedPointIndex === null) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        let newX = Math.round((e.clientX - rect.left) * scaleX);
        let newY = Math.round((e.clientY - rect.top) * scaleY);

        newX = Math.max(0, Math.min(CANVAS_NATIVE_WIDTH, newX));
        newY = Math.max(0, Math.min(CANVAS_NATIVE_HEIGHT, newY));

        roiPoints[draggedPointIndex].x = newX;
        roiPoints[draggedPointIndex].y = newY;

        drawROICanvas();
        updateCoordinateBadges();
    });

    window.addEventListener('mouseup', () => {
        draggedPointIndex = null;
    });

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const touchX = (touch.clientX - rect.left) * scaleX;
        const touchY = (touch.clientY - rect.top) * scaleY;

        for (let i = 0; i < roiPoints.length; i++) {
            const dx = touchX - roiPoints[i].x;
            const dy = touchY - roiPoints[i].y;
            if (Math.hypot(dx, dy) <= POINT_RADIUS * 2) {
                draggedPointIndex = i;
                e.preventDefault();
                break;
            }
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (draggedPointIndex === null) return;
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        let newX = Math.round((touch.clientX - rect.left) * scaleX);
        let newY = Math.round((touch.clientY - rect.top) * scaleY);

        newX = Math.max(0, Math.min(CANVAS_NATIVE_WIDTH, newX));
        newY = Math.max(0, Math.min(CANVAS_NATIVE_HEIGHT, newY));

        roiPoints[draggedPointIndex].x = newX;
        roiPoints[draggedPointIndex].y = newY;

        drawROICanvas();
        updateCoordinateBadges();
        e.preventDefault();
    });

    window.addEventListener('touchend', () => {
        draggedPointIndex = null;
    });

    // Buttons
    const btnSaveROI = document.getElementById('btnSaveROI');
    const btnResetROI = document.getElementById('btnResetROI');
    const statusMsg = document.getElementById('roiSaveStatusMsg');

    if (btnSaveROI) {
        btnSaveROI.addEventListener('click', async () => {
            btnSaveROI.disabled = true;
            btnSaveROI.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> Saving...`;

            const coordsPayload = roiPoints.map(p => [p.x, p.y]);

            try {
                const res = await fetch('/api/set_roi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ coords: coordsPayload })
                });
                const data = await res.json();

                btnSaveROI.disabled = false;
                btnSaveROI.innerHTML = `<i class="fa-solid fa-floppy-disk me-1"></i> Save ROI`;

                if (statusMsg) {
                    statusMsg.className = 'alert alert-success mt-3 py-2 small';
                    statusMsg.innerHTML = `<i class="fa-solid fa-circle-check me-2"></i> ROI Updated Successfully ✓ (${coordsPayload.map(c => `(${c[0]},${c[1]})`).join(' ')})`;
                    statusMsg.classList.remove('d-none');
                    setTimeout(() => statusMsg.classList.add('d-none'), 5000);
                }
            } catch (err) {
                btnSaveROI.disabled = false;
                btnSaveROI.innerHTML = `<i class="fa-solid fa-floppy-disk me-1"></i> Save ROI`;
                alert('Failed to save ROI coordinates.');
            }
        });
    }

    if (btnResetROI) {
        btnResetROI.addEventListener('click', () => {
            roiPoints = [
                { x: 120, y: 180, label: 'P1' },
                { x: 520, y: 180, label: 'P2' },
                { x: 600, y: 440, label: 'P3' },
                { x: 40, y: 440, label: 'P4' }
            ];
            drawROICanvas();
            updateCoordinateBadges();
        });
    }
}

function drawROICanvas() {
    const canvas = document.getElementById('roiCalibrationCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw polygon
    ctx.beginPath();
    ctx.moveTo(roiPoints[0].x, roiPoints[0].y);
    for (let i = 1; i < roiPoints.length; i++) {
        ctx.lineTo(roiPoints[i].x, roiPoints[i].y);
    }
    ctx.closePath();

    // Semi-transparent fill
    ctx.fillStyle = 'rgba(2, 132, 199, 0.22)';
    ctx.fill();

    // Outline
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0284C7';
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Draggable Handles
    roiPoints.forEach((p, idx) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0B3B60';
        ctx.stroke();

        // Inner center
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#38BDF8';
        ctx.fill();

        // Label tag
        ctx.fillStyle = '#0B3B60';
        ctx.fillRect(p.x + 12, p.y - 12, 34, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.fillText(p.label, p.x + 16, p.y + 1);
    });
}

function updateCoordinateBadges() {
    roiPoints.forEach(p => {
        const el = document.getElementById(`roiCoord${p.label}`);
        if (el) {
            el.textContent = `${p.label}: (${p.x}, ${p.y})`;
        }
    });
}

function initSettingsForms() {
    // Sliders live value display
    const confSlider = document.getElementById('confThresholdSlider');
    const confVal = document.getElementById('confThresholdVal');
    if (confSlider && confVal) {
        confSlider.addEventListener('input', () => {
            confVal.textContent = `${Number(confSlider.value).toFixed(2)}`;
        });
    }

    const ttcSlider = document.getElementById('ttcThresholdSlider');
    const ttcVal = document.getElementById('ttcThresholdVal');
    if (ttcSlider && ttcVal) {
        ttcSlider.addEventListener('input', () => {
            ttcVal.textContent = `${Number(ttcSlider.value).toFixed(1)}s`;
        });
    }
}
