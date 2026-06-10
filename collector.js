import { apiFetch } from './api.js';
import { showToast, getStatusClass, openConfirmModal } from './ui.js';
import { getCurrentUser } from './auth.js'; // Added missing import

export async function renderAvailableTasks() {
    const list = document.getElementById('available-tasks-list');
    const openStat = document.getElementById('stat-open');
    if (!list) return;

    const available = await apiFetch('/api/waste_requests/available');
    if (openStat) openStat.textContent = available.length;

    list.innerHTML = available.map(item => `
        <tr>
            <td>${item.location}</td>
            <td>${item.reporter_name}</td>
            <td>${item.waste_type} (${item.quantity} ${item.unit})</td>
            <td>UGX ${(item.fee - item.admin_cut).toLocaleString()}</td>
            <td>
                <button class="register-button accept-task-btn" data-id="${item.id}" style="width:auto; padding:5px 10px; margin-top:0;">Accept</button>
            </td>
        </tr>`).join('');
}

export async function renderCollectorHistory() { // Renamed from renderHistory
    const collectorHistoryList = document.getElementById('collector-history-list');
    const currentUser = getCurrentUser();
    if (!collectorHistoryList || currentUser === 'anonymous') return;

    const history = await apiFetch('/api/waste_requests');
    const myWork = history.filter(item => item.collector_username === currentUser);
    
    collectorHistoryList.innerHTML = myWork.map(item => `
        <tr>
            <td>${new Date(item.timestamp).toLocaleString()}</td>
            <td>${item.reporter_name}</td>
            <td>${item.location}</td>
            <td>${item.waste_type}</td>
            <td>UGX ${(item.fee - item.admin_cut).toLocaleString()}</td>
            <td>
                <span class="status-badge ${getStatusClass(item.status)}">${item.status}</span>
                ${item.status === 'Completed' && !item.system_rating_collector ? 
                    `<br><button onclick="window.openRatingModal('${item.id}', '${item.location.replace(/'/g, "\\'")}', true)" style="margin-top:5px; font-size:0.8em; cursor:pointer; background: #2e7d32; color:white; border:none; border-radius:3px; padding:2px 5px;">Rate System</button>` : 
                    (item.system_rating_collector ? `<br><small style="color:#FFD700;">System Rated: ${item.system_rating_collector} ★</small>` : '')
                }
            </td>
        </tr>
    `).join('');

    const accuracyRatingStat = document.querySelector('#view-tasks .stat-card:nth-child(3) p');
    const ratedWork = myWork.filter(item => item.reporter_rating);
    if (accuracyRatingStat && ratedWork.length > 0) {
        const avg = ratedWork.reduce((sum, item) => sum + item.reporter_rating, 0) / ratedWork.length;
        accuracyRatingStat.textContent = `${avg.toFixed(1)} ⭐`;
    }

    const totalEarningsDisplay = document.getElementById('collector-total-earnings');
    if (totalEarningsDisplay) {
        const total = myWork.filter(item => item.status === 'Completed').reduce((sum, item) => sum + (item.fee - item.admin_cut), 0);
        totalEarningsDisplay.textContent = `UGX ${total.toLocaleString()}`;
    }

    const debtDisplay = document.getElementById('collector-admin-debt');
    const user = await apiFetch('/api/current_user');
    if (debtDisplay) debtDisplay.textContent = `UGX ${user.admin_debt.toLocaleString()}`;
 }

export async function renderActiveTasks() {
    const activeTasksContainer = document.getElementById('active-tasks-container');
    const noTasksMsg = document.getElementById('no-tasks-msg');
    if (!activeTasksContainer) return;

    const history = await apiFetch('/api/waste_requests');
    const currentUser = getCurrentUser();
    const activeTasks = history.filter(item => item.collector_username === currentUser && item.status === 'Accepted');
    
    if (noTasksMsg) {
        if (activeTasks.length > 0) noTasksMsg.classList.add('hidden');
        else noTasksMsg.classList.remove('hidden');
    }
    activeTasksContainer.className = "active-tasks-grid";
    activeTasksContainer.innerHTML = '';

    activeTasks.forEach((task) => {
        const taskCard = document.createElement('div');
        taskCard.className = "active-task-card";
        taskCard.innerHTML = `
            <div class="task-header">
                <div class="task-location">${task.location}</div>
                <div class="task-badge">${task.waste_type}</div>
            </div>
            <div class="task-body">
                <div class="task-info-row">👤 <strong>Reporter:</strong> ${task.reporter_name || task.reporter_username}</div>
                <div class="task-info-row">⏰ <strong>Time:</strong> ${new Date(task.timestamp).toLocaleString()}</div>
                <div class="task-info-row">📦 <strong>Volume:</strong> ${task.quantity} ${task.unit}</div>
                <div style="margin-top: 10px;">
                    ${task.payment_method === 'cash' ? 
                        '<span style="color:#f44336; font-weight:bold; font-size:0.85em;">⚠️ COLLECT CASH ON-SITE</span>' : 
                        '<span style="color:#4CAF50; font-weight:bold; font-size:0.85em;">✓ PAID VIA MOBILE MONEY</span>'}
                </div>
            </div>
            <div class="task-footer" style="display:flex; gap:10px; margin-top:10px;">
                <button class="register-button mark-collected-btn" data-id="${task.id}" style="flex:1; margin-top:0; padding:10px;">Complete Task</button>
                <button class="register-button btn-orange" style="width:auto; margin-top:0; padding:10px;" onclick="window.openRatingModal('${task.id}', '${task.location.replace(/'/g, "\\'")}', true)">Rate</button>
            </div>
        `;
        
        taskCard.querySelector('.mark-collected-btn').addEventListener('click', async () => {
            const processCompletion = async (receiptNum) => {
                await apiFetch(`/api/waste_requests/${task.id}/complete`, {
                    method: 'POST',
                    body: { receiptNumber: receiptNum },
                });
                showToast("Task completed successfully!", "success");
                renderActiveTasks();
                renderCollectorHistory();
            };

            if (task.payment_method === 'cash') {
                openConfirmModal(
                    "Physical Receipt Required",
                    "Please enter the physical Receipt Number provided to the customer to finalize this cash collection:",
                    (val) => {
                        if (val && val.trim() !== "") {
                            processCompletion(val);
                        } else {
                            showToast("A receipt number is required to complete cash tasks.", "info");
                        }
                    },
                    true
                );
            } else {
                processCompletion(null);
            }
        });
        activeTasksContainer.appendChild(taskCard);
    });
}

export function setupCollectorTaskListeners() {
    const availableTasksList = document.getElementById('available-tasks-list');
    if (availableTasksList) {
        availableTasksList.addEventListener('click', async (e) => {
            const taskId = e.target.getAttribute('data-id');
            if (!taskId) return;

            if (e.target.classList.contains('accept-task-btn')) {
                await apiFetch(`/api/waste_requests/${taskId}/accept`, { method: 'POST' });
                showToast("Task Accepted! The reporter has been notified.", "success");
                renderAvailableTasks();
                renderActiveTasks();
                renderCollectorHistory();
            } else if (e.target.classList.contains('decline-task-btn')) {
                openConfirmModal("Decline Task", "Are you sure you want to decline this task? It will be reallocated.", async () => {
                    await apiFetch(`/api/waste_requests/${taskId}/decline`, { method: 'POST' });
                    showToast("Task declined and reallocated.", "info");
                    renderAvailableTasks();
                    renderActiveTasks();
                    renderCollectorHistory();
                });
            }
        });
    }
}

export function setupCollectorMMListeners() {
    const collectorMMInput = document.getElementById('collectorMM');
    const saveCollectorMMBtn = document.getElementById('saveCollectorMM');
    const currentUser = getCurrentUser();

    if (collectorMMInput) {
        collectorMMInput.value = localStorage.getItem(`mm_${currentUser}`) || '';
    }

    if (saveCollectorMMBtn) {
        saveCollectorMMBtn.addEventListener('click', () => {
            const num = collectorMMInput.value;
            if (num) {
                localStorage.setItem(`mm_${currentUser}`, num);
                showToast("Mobile Money number saved for payouts.", "success");
            }
        });
    }
}

export function setupDebtSettlementListener() {
    const settleDebtBtn = document.getElementById('settleDebtBtn');
    if (settleDebtBtn) {
        settleDebtBtn.addEventListener('click', () => {
            const debt = document.getElementById('collector-admin-debt').textContent;
            openConfirmModal("Settle System Fees", `You are about to pay ${debt} to the Admin via Mobile Money. Proceed to STK Push?`, async () => {
                showToast("Requesting payment... Please check your phone for the PIN prompt.", "info");
                // In a real app, this would call your Payment Gateway API
                // Now, call the backend to actually clear the debt
                const response = await apiFetch('/api/collector/settle_debt', { method: 'POST' });
                if (response.status === "success") {
                    showToast(response.message, "success");
                    // Immediate UI update to zero before re-fetching
                    if (document.getElementById('collector-admin-debt')) document.getElementById('collector-admin-debt').textContent = "UGX 0";
                    renderCollectorHistory(); 
                } else {
                    showToast(response.message, "error");
                }
            });
        });
    }
}

export function setupAvailabilityToggle() {
    const availabilityToggle = document.getElementById('availabilityToggle');
    const availabilityStatus = document.getElementById('availabilityStatus');

    if (availabilityToggle) {
        // Fetch initial state from current user data if possible, or default to checked
        apiFetch('/api/current_user', { silent: true }).then(user => {
            availabilityToggle.checked = user.is_available;
            availabilityStatus.textContent = user.is_available ? "On Duty" : "Off Duty";
        });

        availabilityToggle.addEventListener('change', async (e) => {
            const isAvailable = e.target.checked;
            await apiFetch('/api/users/availability', { method: 'POST', body: { available: isAvailable } });
            availabilityStatus.textContent = isAvailable ? "On Duty" : "Off Duty";
            showToast(`You are now ${isAvailable ? 'Available' : 'Unavailable'} for new tasks.`, "info");
        });
    }
}