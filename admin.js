import { apiFetch } from './api.js';
import { showToast, switchView, openConfirmModal } from './ui.js'; // Correct path
import { getCurrentUser, getUserRole, getSystemStatus, fetchSystemStatus } from './auth.js'; // Added missing import
 
export async function renderAnalytics() {
    const hotspotsList = document.getElementById('admin-hotspots-list');
    const statusSummary = document.getElementById('admin-status-summary');
    const systemRatingDisplay = document.getElementById('admin-system-rating');
    if (!hotspotsList) return;

    const data = await apiFetch('/api/admin/analytics');

    hotspotsList.innerHTML = Object.entries(data.hotspots)
        .sort((a, b) => b[1] - a[1])
        .map(([parish, count]) => `
            <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee;">
                <span>${parish}</span>
                <span style="font-weight: bold; color: #3F51B5;">${count} reports</span>
            </div>
        `).join('') || '<p style="color:#999">No data yet</p>';

    statusSummary.innerHTML = `
        <div style="margin-bottom: 10px;">Pending Cases: <strong>${data.pending}</strong></div>
        <div style="margin-bottom: 10px;">Confirmed (Accepted): <strong>${data.confirmed}</strong></div>
        <div style="margin-bottom: 10px;">Completed: <strong>${data.completed}</strong></div>
    `;

    const history = await apiFetch('/api/waste_requests');
    const systemRatings = history.flatMap(r => [r.system_rating_reporter, r.system_rating_collector].filter(v => v > 0));
    
    if (systemRatingDisplay) {
        const avg = systemRatings.length > 0 ? (systemRatings.reduce((a, b) => a + b, 0) / systemRatings.length).toFixed(1) : "0.0";
        systemRatingDisplay.textContent = `${avg} ⭐`;
    }
}

export async function renderUserList() {
    const collectorsTable = document.getElementById('admin-collectors-list');
    const reportersTable = document.getElementById('admin-reporters-list');
    const pendingUsersTable = document.getElementById('admin-pending-users-list');
    
    const allUsers = await apiFetch('/api/users');
    const pendingUsers = allUsers.filter(user => user.status === 'pending');
    const activeInactiveUsers = allUsers.filter(user => user.status !== 'pending');

    if (pendingUsersTable) {
        pendingUsersTable.innerHTML = pendingUsers.map(user => `
            <tr>
                <td style="font-weight: bold;">${user.username}</td>
                <td><span class="badge">${user.role}</span></td>
                <td>${user.companyName || 'N/A'}</td>
                <td>${user.location || 'N/A'}</td>
                <td>${user.contact || 'N/A'}</td>
                <td>
                    <button class="action-link" onclick="window.approveUser('${user.username}')" style="color: #4CAF50;">Approve</button>
                    <button class="action-link delete-link" onclick="window.rejectUser('${user.username}')">Reject</button>
                </td>
            </tr>`).join('');
    }

    const renderTable = (list, element) => {
        if (!element) return;
        element.innerHTML = list.map(user => `
            <tr>
                <td style="font-weight: bold;">${user.username}</td>
                ${user.role === 'Collector' ? `<td>${user.companyName || 'N/A'}</td><td>${user.location || 'N/A'}</td>` : ''}
                <td><span class="status-badge ${user.status === 'active' ? 'status-active' : 'status-inactive'}">${user.status || 'active'}</span></td>
                <td>
                    <button class="action-link" onclick="window.selectChat('${user.username}'); switchView('view-messages');" style="color: #3F51B5;">Message</button>
                    ${user.username !== 'admin' ? `
                        <button class="action-link deactivate-link" onclick="window.toggleUserStatus('${user.username}')">Toggle</button>
                        <button class="action-link delete-link" onclick="window.deleteUser('${user.username}')">Delete</button>
                    ` : ''}
                </td>
            </tr>`).join('');
    };

    renderTable(activeInactiveUsers.filter(u => u.role === 'Collector'), collectorsTable);
    renderTable(activeInactiveUsers.filter(u => u.role === 'Reporter'), reportersTable);
}

window.approveUser = (username) => {
    openConfirmModal("Approve User", `Approve "${username}"?`, async () => {
        await apiFetch(`/api/users/${username}/approve`, { method: 'POST' });
        showToast(`User ${username} approved.`);
        renderUserList();
    });
};

// --- Admin System Toggle & Broadcast Logic (Moved from main.js) ---
let currentRates = {}; // Local cache for immediate UI updates

export async function renderAdminRates(existingData = null) {
    const ratesTable = document.getElementById('admin-rates-list');
    if (!ratesTable) return;
    
    if (existingData) currentRates = existingData;
    else {
        try {
            const data = await apiFetch('/api/settings/rates', { silent: true });
            currentRates = JSON.parse(data.value);
        } catch (error) {
            console.error('Error fetching rates:', error);
            currentRates = {
                "Mutungo": 15000, "Luzira": 18000, "Bugolobi": 20000,
                "Naguru": 22000, "Nakawa": 12000, "Ntinda": 20000,
                "Kiwatule": 25000, "Banda": 15000
            };
        }
    }

    ratesTable.innerHTML = Object.keys(currentRates).map(parish => {
        const safeParish = parish.replace(/'/g, "\\'");
        return `
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px;">${parish}</td>
            <td>${currentRates[parish].toLocaleString()}</td>
            <td>
                <button onclick="window.editRate('${safeParish}')" style="color: blue; border:none; background:none; cursor:pointer; font-weight:bold;">Edit</button>
                <button onclick="window.deleteRate('${safeParish}')" style="color: red; border:none; background:none; cursor:pointer; font-weight:bold;">Delete</button>
            </td>
        </tr>
    `;}).join('');
}

export const adminEditRate = (parish) => { // Renamed to avoid conflict with window.editRate
    openConfirmModal("Update Rate", `Update service fee for ${parish} (UGX):`, (newRate) => {
        if (newRate !== null && !isNaN(newRate) && newRate.trim() !== "") {
            updateRate(parish, newRate);
        } else {
            showToast("Invalid rate entered.", "info");
        }
    }, true);
};

async function updateRate(parish, newRate) {
    const rateVal = parseInt(newRate);
    if (isNaN(rateVal) || rateVal <= 0) return showToast("Please enter a valid amount.", "info");
    
    currentRates[parish] = rateVal;
    await apiFetch('/api/settings/rates', {
        method: 'POST',
        body: { value: JSON.stringify(currentRates) },
    });
    renderAdminRates(currentRates); 
    showToast(`Rate for ${parish} updated!`);
    // Assuming renderReporterParishes is in reporter.js and needs to be called
    if (window.renderReporterParishes) window.renderReporterParishes();
}

export const adminDeleteRate = (parish) => { // Renamed to avoid conflict with window.deleteRate
    openConfirmModal("Delete Rate", `Are you sure you want to delete the rate for ${parish}?`, async () => {
        delete currentRates[parish];
        await apiFetch('/api/settings/rates', {
            method: 'POST',
            body: { value: JSON.stringify(currentRates) },
        });
        showToast(`Rate for ${parish} deleted.`);
        renderAdminRates(currentRates); 
        if (window.renderReporterParishes) window.renderReporterParishes();
    });
};

export const adminAddRate = () => { // Renamed to avoid conflict with window.addRate
    openConfirmModal("Add New Parish Rate", "Enter new parish name and its default rate (e.g., 'NewParish:25000'):", async (input) => {
        if (!input || !input.includes(':')) return showToast("Invalid format. Use 'ParishName:Rate'.", "info");
        const [parishName, rateStr] = input.split(':');
        const parish = parishName.trim();
        const rate = parseInt(rateStr.trim());
        
        if (!parish) return showToast("Parish name cannot be empty.", "info");
        if (isNaN(rate) || rate <= 0) return showToast("Invalid rate value.", "info");

        if (currentRates[parish]) {
            return showToast(`Parish "${parish}" already exists!`, "error");
        }

        currentRates[parish] = rate;
        await apiFetch('/api/settings/rates', {
            method: 'POST',
            body: { value: JSON.stringify(currentRates) },
        });
        showToast(`Rate for ${parish} added.`);
        renderAdminRates(currentRates); 
        if (window.renderReporterParishes) window.renderReporterParishes();
    }, true);
};

export async function setupSystemControlListeners() {
    const systemToggle = document.getElementById('systemToggle');
    const broadcastBtn = document.getElementById('broadcastMaintenanceBtn');
    const maintModal = document.getElementById('maintenanceBroadcastModal');
    const maintMessageInput = document.getElementById('maint-message');
    const cancelMaintBtn = document.getElementById('cancelMaintBtn');
    const sendMaintBroadcastBtn = document.getElementById('sendMaintBroadcastBtn');

    if (systemToggle) {
        await fetchSystemStatus(); // Ensure systemStatus is up-to-date
        systemToggle.checked = getSystemStatus() === 'on';
        updateSystemUI(getSystemStatus());
        systemToggle.addEventListener('change', async (e) => {
            if (!e.target.checked) {
                await updateSystemStatus('off'); // Turn system off immediately when toggled
                maintModal.classList.remove('hidden');
            } else {
                await updateSystemStatus('on');
            }
        });
    }

    if (cancelMaintBtn) {
        cancelMaintBtn.addEventListener('click', () => {
            maintModal.classList.add('hidden');
            if (getSystemStatus() === 'on' && systemToggle) {
                systemToggle.checked = true;
            }
        });
    }

    if (sendMaintBroadcastBtn) {
        sendMaintBroadcastBtn.addEventListener('click', async () => {
            const msg = maintMessageInput.value.trim();
            if (!msg) return showToast("Message cannot be empty", "info");
            
            await apiFetch('/api/settings/maintenance_message', {
                method: 'POST',
                body: { value: msg },
            });
            
            const users = await apiFetch('/api/users'); // Fetch all users
            for (const u of users) {
                if (u.username !== getCurrentUser()) { // Don't send to admin
                    await apiFetch('/api/messages', {
                        method: 'POST',
                        body: { recipient: u.username, content: `⚠️ [ADMIN BROADCAST]: ${msg}`, sender: 'Admin' } // Explicitly set sender to Admin
                    });
                }
            }
            if (window.updateUnreadCount) window.updateUnreadCount(getCurrentUser());

            maintModal.classList.add('hidden');
            showToast("Broadcast message sent to all users.", "success");
        });
    }

    if (broadcastBtn) {
        broadcastBtn.addEventListener('click', () => maintModal.classList.remove('hidden'));
    }
}

async function updateSystemStatus(status) {
    const data = await apiFetch('/api/settings/system_status', {
        method: 'POST',
        body: { value: status },
    });
    if (data.status === "success") {
        if (fetchSystemStatus) await fetchSystemStatus(); // Update global status
        updateSystemUI(status);
        if (status === 'on') showToast("System is now Online", "success");
    } else {
        showToast(data.message, "error");
    }
}

function updateSystemUI(status) {
    const systemStatusText = document.getElementById('system-status-text');
    const broadcastBtn = document.getElementById('broadcastMaintenanceBtn');
    if (!systemStatusText || !broadcastBtn) return;
    systemStatusText.textContent = `System Status: ${status === 'on' ? 'Online' : 'Maintenance'}`;
    systemStatusText.style.color = status === 'on' ? '#2e7d32' : '#c62828';
}

export async function fetchAdminMM() {
    const adminMMInput = document.getElementById('adminMMNumber');
    if (!adminMMInput) return;
    const data = await apiFetch('/api/settings/admin_mobile_money', { silent: true });
    adminMMInput.value = data.value !== 'Not Set' ? data.value : '';
}

export async function saveAdminMM() {
    const val = document.getElementById('adminMMNumber').value;
    const data = await apiFetch('/api/settings/admin_mobile_money', {
        method: 'POST',
        body: { value: val },
    });
    if (data.status === "success") showToast("Admin Payout Number updated!", "success");
}

export async function renderAdminAlerts() {
    const container = document.getElementById('admin-alerts-container');
    if (!container) return;
    
    const allUsers = await apiFetch('/api/users');
    const pendingUsers = allUsers.filter(u => u.status === 'pending');
    
    let alertHtml = '';

    if (pendingUsers.length > 0) {
        alertHtml += `
            <div class="admin-approval-alert">
                <div class="alert-content">
                    <h4>Action Required</h4>
                    <p>You have <strong>${pendingUsers.length}</strong> user${pendingUsers.length > 1 ? 's' : ''} awaiting approval.</p>
                </div>
                <button class="view-users-btn" onclick="switchView('admin-users')">View List</button>
            </div>
        `;
    }

    if (!alertHtml) {
        alertHtml = '<p style="color: #666;">No recent activity.</p>';
    }
    
    container.innerHTML = alertHtml;
}

export async function clearAllRecords() {
    openConfirmModal("Clear All Records", "Are you sure you want to PERMANENTLY delete all transaction logs? This cannot be undone.", async () => {
        const data = await apiFetch('/api/admin/clear_all', { method: 'POST' });
        if (data.status === "success") {
            showToast(data.message, "success");
            if (window.renderAdminLogs) window.renderAdminLogs(); // Assuming this is a separate function now
            renderAnalytics();
        } else {
            showToast(data.message, "error");
        }
    });
}

export async function renderAdminFinancialSummary() {
    const revenueStat = document.getElementById('system-revenue');
    const maintenanceStat = document.getElementById('admin-total-maintenance'); // This now represents total earned
    const availableForWithdrawalStat = document.getElementById('available-for-withdrawal');
    const withdrawFeesBtn = document.getElementById('withdrawFeesBtn');

    if (!revenueStat || !maintenanceStat || !availableForWithdrawalStat) return;

    const summary = await apiFetch('/api/admin/financial_summary');

    revenueStat.textContent = `UGX ${summary.total_admin_cut_earned.toLocaleString()}`;
    maintenanceStat.textContent = `UGX ${summary.total_admin_cut_withdrawn.toLocaleString()}`;
    availableForWithdrawalStat.textContent = `UGX ${summary.available_for_withdrawal.toLocaleString()}`;

    if (withdrawFeesBtn) {
        withdrawFeesBtn.disabled = summary.available_for_withdrawal <= 0;
        withdrawFeesBtn.onclick = () => handleWithdrawFees(summary.available_for_withdrawal);
    }
}

export async function renderAdminWithdrawalHistory() {
    const withdrawalHistoryList = document.getElementById('admin-withdrawal-history-list');
    if (!withdrawalHistoryList) return;

    const withdrawals = await apiFetch('/api/admin/withdrawals');

    withdrawalHistoryList.innerHTML = withdrawals.map(item => `
        <tr>
            <td>${new Date(item.timestamp).toLocaleString()}</td>
            <td>UGX ${item.amount.toLocaleString()}</td>
            <td>${item.method === 'mobileMoney' ? 'Mobile Money' : 'Bank Transfer'}</td>
            <td>${item.details.account_number || item.details.mobile_number || 'N/A'}</td>
            <td>${item.admin_username}</td>
        </tr>
    `).join('');
}

export async function handleWithdrawFees(maxAmount) {
    const withdrawalModal = document.getElementById('withdrawalModal');
    const withdrawAmountInput = document.getElementById('withdrawAmount');
    const withdrawMethodSelect = document.getElementById('withdrawMethod');
    const mobileMoneyDetails = document.getElementById('mobileMoneyWithdrawalDetails');
    const bankTransferDetails = document.getElementById('bankTransferWithdrawalDetails');
    const withdrawMMNumber = document.getElementById('withdrawMMNumber');
    const withdrawBankName = document.getElementById('withdrawBankName');
    const withdrawAccountNumber = document.getElementById('withdrawAccountNumber');
    const withdrawAccountName = document.getElementById('withdrawAccountName');
    const confirmWithdrawBtn = document.getElementById('confirmWithdrawBtn');
    const cancelWithdrawBtn = document.getElementById('cancelWithdrawBtn');

    if (!withdrawalModal) return;

    withdrawAmountInput.value = '';
    withdrawAmountInput.max = maxAmount;
    withdrawMethodSelect.value = '';
    mobileMoneyDetails.classList.add('hidden');
    bankTransferDetails.classList.add('hidden');
    withdrawMMNumber.value = '';
    withdrawBankName.value = '';
    withdrawAccountNumber.value = '';
    withdrawAccountName.value = '';

    withdrawMethodSelect.onchange = () => {
        mobileMoneyDetails.classList.toggle('hidden', withdrawMethodSelect.value !== 'mobileMoney');
        bankTransferDetails.classList.toggle('hidden', withdrawMethodSelect.value !== 'bankTransfer');
    };

    confirmWithdrawBtn.onclick = async () => {
        const amount = parseFloat(withdrawAmountInput.value);
        const method = withdrawMethodSelect.value;
        let details = {};

        if (method === 'mobileMoney') {
            details = { mobile_number: withdrawMMNumber.value };
        } else if (method === 'bankTransfer') {
            details = { bank_name: withdrawBankName.value, account_number: withdrawAccountNumber.value, account_name: withdrawAccountName.value };
        }

        if (amount <= 0 || amount > maxAmount || isNaN(amount)) {
            return showToast(`Please enter a valid amount up to UGX ${maxAmount.toLocaleString()}.`, "error");
        }
        if (!method || (method === 'mobileMoney' && !details.mobile_number) || (method === 'bankTransfer' && (!details.bank_name || !details.account_number || !details.account_name))) {
            return showToast("Please fill in all withdrawal details.", "error");
        }

        await apiFetch('/api/admin/withdraw_fees', { method: 'POST', body: { amount, method, details } });
        showToast("Withdrawal request submitted!", "success");
        withdrawalModal.classList.add('hidden');
        renderAdminFinancialSummary(); // Refresh financials
        renderAdminWithdrawalHistory(); // Refresh history
    };

    cancelWithdrawBtn.onclick = () => withdrawalModal.classList.add('hidden');
    withdrawalModal.classList.remove('hidden');
}

export async function recalculateAdminCuts() {
    openConfirmModal("Recalculate Admin Cuts", "This will recalculate the 2% admin cut for all existing transactions that currently have 0. Are you sure?", async () => {
        try {
            const response = await apiFetch('/api/admin/recalculate_admin_cuts', { method: 'POST' });
            if (response.status === "success") {
                showToast(response.message, "success");
                renderAdminFinancialSummary(); 
                renderAdminLogs(); 
            } else {
                showToast(response.message, "error");
            }
        } catch (error) {
            showToast(`Error during recalculation: ${error.message}`, "error");
        }
    });
}

export async function renderAdminLogs() {
    const adminLogList = document.getElementById('admin-log-list');
    if (!adminLogList) return;

    // Fetch both history and users in parallel for better performance
    const [history, users] = await Promise.all([
        apiFetch('/api/waste_requests'),
        apiFetch('/api/users')
    ]);

    adminLogList.innerHTML = history.reverse().map(item => `
        <tr>
            <td>${new Date(item.timestamp).toLocaleString()}</td>
            <td style="font-weight:bold;">${item.reporter_name || item.reporter_username || 'N/A'}</td>
            <td>${item.location}</td>
            <td>UGX ${(item.fee || 0).toLocaleString()}</td>
            <td>UGX ${(item.admin_cut || 0).toLocaleString()}</td>
            <td style="font-weight:bold;">${item.collector_username || '<span style="color:#999">Unassigned</span>'}</td>
            <td><span class="status-badge ${getStatusClass(item.status)}">${item.status}</span></td>
        </tr>
    `).join('');
    
    const userStat = document.getElementById('admin-stat-users');
    const dashboardUserStat = document.getElementById('system-users'); // Check both possible IDs
    if (userStat) userStat.textContent = users.length;
    if (dashboardUserStat) dashboardUserStat.textContent = users.length;

    const historyStat = document.getElementById('admin-stat-history');
    if (historyStat) {
        historyStat.textContent = history.length;
    }
}

window.toggleUserStatus = (username) => {
    openConfirmModal("Toggle Status", `Change status for "${username}"?`, async () => {
        const data = await apiFetch(`/api/users/${username}/toggle_status`, { method: 'POST' });
        showToast(data.message);
        renderUserList();
    });
};