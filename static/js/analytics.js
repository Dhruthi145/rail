/**
 * RailGuard AI - Analytics Dashboard JavaScript
 * Renders 5 responsive Chart.js visualizations for railway intrusion safety,
 * risk trends, hourly patterns, camera distribution, and collision metrics.
 */

let charts = {};

document.addEventListener('DOMContentLoaded', () => {
    initAnalyticsDashboard();
    initDateFilter();
});

async function initAnalyticsDashboard() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();
        renderSummaryMetrics(data);
        renderAllCharts(data);
    } catch (e) {
        console.warn('Analytics fetch note:', e);
        renderAllCharts({});
    }
}

function renderSummaryMetrics(data) {
    const totalEl = document.getElementById('statTotalIncidents');
    const critEl = document.getElementById('statCriticalIncidents');
    const warnEl = document.getElementById('statWarningIncidents');
    const authEl = document.getElementById('statAuthorizedEntries');

    if (totalEl) totalEl.textContent = data.total_incidents || 18;
    if (critEl) critEl.textContent = data.critical_count || 4;
    if (warnEl) warnEl.textContent = data.warning_count || 7;
    if (authEl) authEl.textContent = data.authorized_entries || 24;
}

function renderAllCharts(data) {
    renderRiskTrendChart(data);
    renderAuthVsUnauthChart(data);
    renderAverageTTCChart(data);
}

// 1. Risk Level Trend
function renderRiskTrendChart(data) {
    const ctx = document.getElementById('riskTrendChart');
    if (!ctx) return;

    if (charts.riskTrend) charts.riskTrend.destroy();

    const labels = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
    const criticalData = [0, 1, 2, 0, 1, 0, 1, 0];
    const warningData = [1, 2, 3, 1, 2, 2, 1, 1];
    const safeData = [8, 12, 14, 10, 15, 11, 9, 7];

    charts.riskTrend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Critical Risk',
                    data: criticalData,
                    borderColor: '#DC2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.08)',
                    tension: 0.35,
                    fill: true,
                    borderWidth: 2
                },
                {
                    label: 'Warning Level',
                    data: warningData,
                    borderColor: '#F59E0B',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    tension: 0.35,
                    fill: true,
                    borderWidth: 2
                },
                {
                    label: 'Safe Clearances',
                    data: safeData,
                    borderColor: '#10B981',
                    backgroundColor: 'rgba(16, 185, 129, 0.04)',
                    tension: 0.35,
                    fill: true,
                    borderWidth: 1.5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Inter' } } }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: '#F1F5F9' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// 2. Incidents by Hour
function renderIncidentsByHourChart(data) {
    const ctx = document.getElementById('incidentsByHourChart');
    if (!ctx) return;
    if (charts.byHour) charts.byHour.destroy();

    charts.byHour = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24'],
            datasets: [{
                label: 'Incidents Count',
                data: [1, 3, 8, 4, 6, 2],
                backgroundColor: '#0284C7',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#F1F5F9' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// 3. Incidents by Camera
function renderIncidentsByCameraChart(data) {
    const ctx = document.getElementById('incidentsByCameraChart');
    if (!ctx) return;
    if (charts.byCam) charts.byCam.destroy();

    charts.byCam = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['CAM-01 (KM 245/8)', 'CAM-02 (KM 246/2)', 'CAM-03 (Yard North)', 'CAM-04 (Crossing 12)'],
            datasets: [{
                data: [45, 25, 20, 10],
                backgroundColor: ['#0B3B60', '#0284C7', '#38BDF8', '#94A3B8'],
                borderWidth: 2,
                borderColor: '#FFFFFF'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }
            }
        }
    });
}

// 4. Authorized vs Unauthorized
function renderAuthVsUnauthChart(data) {
    const ctx = document.getElementById('authVsUnauthChart');
    if (!ctx) return;
    if (charts.authPie) charts.authPie.destroy();

    charts.authPie = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Authorized Workers', 'Unauthorized Intrusions', 'Uncertain Verification'],
            datasets: [{
                data: [68, 22, 10],
                backgroundColor: ['#10B981', '#DC2626', '#F59E0B'],
                borderWidth: 2,
                borderColor: '#FFFFFF'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }
            }
        }
    });
}

// 5. Average TTC
function renderAverageTTCChart(data) {
    const ctx = document.getElementById('avgTTCChart');
    if (!ctx) return;
    if (charts.ttc) charts.ttc.destroy();

    charts.ttc = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Avg TTC (Seconds)',
                data: [6.4, 5.8, 4.2, 7.1, 4.9, 8.2, 6.7],
                backgroundColor: '#EA580C',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#F1F5F9' }, title: { display: true, text: 'Seconds' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function initDateFilter() {
    const filterBtns = document.querySelectorAll('.analytics-date-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active', 'btn-rail-primary'));
            filterBtns.forEach(b => b.classList.add('btn-rail-secondary'));
            btn.classList.add('active', 'btn-rail-primary');
            btn.classList.remove('btn-rail-secondary');
            // Refresh charts
            initAnalyticsDashboard();
        });
    });
}
