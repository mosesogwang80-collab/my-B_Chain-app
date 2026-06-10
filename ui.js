import { apiFetch } from './api.js'; // Correct path
import { getCurrentUser, getUserRole } from './auth.js';

export function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.zIndex = '10000';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        container.style.pointerEvents = 'none';
        container.style.width = 'auto';
        container.style.maxWidth = '90%';
        container.style.alignItems = 'center';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

export function openConfirmModal(title, message, callback, hasInput = false) {
    const modal = document.getElementById('confirmationModal');
    if (!modal) return;

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    
    const input = document.getElementById('confirmInput');
    if (hasInput) {
        input.classList.remove('hidden');
        input.value = '';
    } else {
        input.classList.add('hidden');
    }

    const proceedBtn = document.getElementById('proceedActionBtn');
    const cancelBtn = document.getElementById('cancelActionBtn');

    proceedBtn.onclick = () => {
        const val = hasInput ? input.value : true;
        callback(val);
        modal.classList.add('hidden');
    };
    cancelBtn.onclick = () => modal.classList.add('hidden');
    modal.classList.remove('hidden');
}

export function switchView(targetId) { // This function is already in main.js, but keeping it here for completeness
    const backBtn = document.getElementById('globalBackBtn');
    const homeViews = ['admin-overview', 'view-tasks', 'view-overview'];
    const views = document.querySelectorAll('.dashboard-view');
    const sidebarLinks = document.querySelectorAll('.sidebar-link, .nav-link');

    if (backBtn) {
        if (homeViews.includes(targetId)) {
            backBtn.classList.add('hidden');
        } else {
            backBtn.classList.remove('hidden');
        }
    }

    views.forEach(view => view.classList.add('hidden'));
    const targetElement = document.getElementById(targetId);
    if (targetElement) {
        targetElement.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    sidebarLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-target') === targetId) {
            link.classList.add('active');
        }
    });
}

export function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export function getStatusClass(status) {
    if (status === 'Accepted') return 'status-accepted';
    if (status === 'Completed') return 'status-completed';
    if (status.includes('Pending (Cash)')) {
        return 'status-pending-cash';
    } else if (status.includes('Pending')) {
        return 'status-pending';
    } else if (status.includes('Paid')) {
        return 'status-paid';
    }
    return '';
}

// --- Rating System Logic (Moved from main.js) ---
let selectedCollectorRating = 0;
let selectedSystemRating = 0;
let activeRatingId = null;

function setupStars(stars, setter) {
    stars.forEach(star => {
        star.addEventListener('click', () => {
            const val = parseInt(star.getAttribute('data-value'));
            setter(val);
            stars.forEach(s => {
                s.classList.toggle('selected', parseInt(s.getAttribute('data-value')) <= val);
            });
        });
    });
}

export function setupRatingModal() {
    const ratingModal = document.getElementById('ratingModal');
    const collectorStars = document.querySelectorAll('#collector-stars .star');
    const systemStars = document.querySelectorAll('#system-stars .star');

    if (ratingModal) {
        setupStars(collectorStars, (v) => selectedCollectorRating = v);
        setupStars(systemStars, (v) => selectedSystemRating = v);

        document.getElementById('cancelRatingBtn')?.addEventListener('click', () => {
            ratingModal.classList.add('hidden');
        });

        document.getElementById('submitRatingBtn')?.addEventListener('click', async () => {
            const userRole = getUserRole();
            const needsCollectorRating = userRole === 'Reporter';
            if (selectedSystemRating === 0 || (needsCollectorRating && selectedCollectorRating === 0)) {
                showToast("Please provide the required ratings.", "info");
                return;
            }

            const ratingData = {
                collectorRating: selectedCollectorRating,
                systemRating: selectedSystemRating
            };

            await apiFetch(`/api/waste_requests/${activeRatingId}/rate`, {
                method: 'POST',
                body: ratingData,
            });
            showToast("Thank you for your feedback!", "success");
            ratingModal.classList.add('hidden');
            // Re-render history/analytics based on role
            if (window.renderReporterHistory) window.renderReporterHistory();
            if (window.renderCollectorHistory) window.renderCollectorHistory();
            if (window.renderAnalytics) window.renderAnalytics();
        });
    }
}

export function openRatingModal(id, location, isCollector = false) {
    activeRatingId = id;
    selectedCollectorRating = 0;
    selectedSystemRating = 0;
    const infoElem = document.getElementById('ratingTaskInfo');
    if (infoElem) infoElem.textContent = location;
        
    const collSection = document.getElementById('collector-rating-section');
    if (collSection) collSection.classList.toggle('hidden', isCollector);

    document.querySelectorAll('#collector-stars .star').forEach(s => s.classList.remove('selected'));
    document.querySelectorAll('#system-stars .star').forEach(s => s.classList.remove('selected'));
    document.getElementById('ratingModal')?.classList.remove('hidden');
};

// --- Report Export & Printing Logic (Moved from main.js) ---
export function printRecords() {
    const activeView = document.querySelector('.dashboard-view:not(.hidden)');
    if (!activeView) return;

    const printClone = activeView.cloneNode(true);
    printClone.querySelectorAll('.stat-card[style*="border-left: 5px solid #3F51B5"], .back-btn, button, .chat-input, .chat-selector, select').forEach(el => el.remove());

    const content = printClone.innerHTML;
    if (!content.trim()) {
        showToast("No records available to print in this view.", "info");
        return;
    }
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>B_Chain Report</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; color: #333; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; }
                    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                    th { background-color: #3F51B5 !important; color: white !important; -webkit-print-color-adjust: exact; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .logo { max-width: 120px; }
                    tfoot { font-weight: bold; background: #f9f9f9; }
                    h1, h2, h3 { color: #3F51B5; }
                    .chat-message { border-bottom: 1px solid #eee; padding: 5px; margin-bottom: 5px; }
                    .sent { text-align: right; color: #2e7d32; font-weight: bold; }
                    .received { text-align: left; color: #3F51B5; }
                </style>
            </head>
            <body>
                <div class="header">
                    <img src="logo.png" class="logo">
                    <h1>${activeView.querySelector('h2')?.innerText || 'B_Chain System Report'}</h1>
                    <p>Generated on: ${new Date().toLocaleString()}</p>
                </div>
                ${content}
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.onload = function() {
        printWindow.print();
        printWindow.close();
    };
};

export function exportToPDF() {
    window.printRecords();
};

export function exportToExcel() {
    const activeView = document.querySelector('.dashboard-view:not(.hidden)');
    if (!activeView) return;
    
    const tables = activeView.querySelectorAll('table');
    if (tables.length === 0) {
        showToast("No tabular data found in this view to export to Excel.", "info");
        return;
    }

    let csv = [];
    tables.forEach((table, tIdx) => {
        if (tIdx > 0) csv.push("\n");
        
        const sectionTitle = table.previousElementSibling?.tagName === 'H3' ? table.previousElementSibling.innerText : "";
        if (sectionTitle) csv.push(`"${sectionTitle}"`);
    
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => `"${th.innerText.trim().replace(/"/g, '""')}"`);
        if (headers.length > 0) csv.push(headers.join(','));
    
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        rows.forEach(tr => {
            const row = Array.from(tr.querySelectorAll('td'))
                .filter(td => !td.querySelector('button') && !td.querySelector('.action-link'))
                .map(td => `"${td.innerText.trim().replace(/"/g, '""')}"`);
            if (row.length > 0) csv.push(row.join(','));
        });
        
        if (table.id === 'admin-transactions-table') {
            const mLabel = table.querySelector('tfoot td:first-child')?.innerText.trim() || "Total Maintenance";
            const mVal = document.getElementById('admin-total-maintenance')?.innerText.trim() || "0";
            csv.push(`"","","${mLabel}","${mVal}",""`);
        }
    });

    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `BChain_Transactions_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}