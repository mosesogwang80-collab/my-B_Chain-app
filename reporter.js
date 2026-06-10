import { apiFetch } from './api.js';
import { showToast, openConfirmModal, getStatusClass, switchView } from './ui.js'; // Correct path
import { getCurrentUser, getUserRole } from './auth.js'; // Correct path
import { renderChatList, updateUnreadCount } from './chat.js'; // Correct path
 
// Data structure to store mobile money numbers per user
// Mapping of Parishes to Zones/Villages
const parishZones = {
    "Mutungo": ["Zone I", "Zone II", "Zone III", "Kasokoso"],
    "Luzira": ["Luzira Central", "Kitintale", "Wankulukuku"],
    "Bugolobi": ["Village 1", "Village 2", "Village 3", "Luthuli"],
    "Naguru": ["Naguru I", "Naguru II", "Katali", "Upper Naguru"],
    "Nakawa": ["Nakawa Market", "Naguru Go-down", "Port Bell Road"],
    "Ntinda": ["Kigowa", "Stretcher", "Minister's Village", "Ntinda II"],
    "Kiwatule": ["Kiwatule Central", "Kungu", "Sunset"],
    "Banda": ["Banda B1", "Banda Zone 2", "Banda B3"]
};

let currentRates = {}; // Local cache for immediate UI updates
let currentlyAssignedCompany = null;

export async function fetchRates() {
    try {
        const data = await apiFetch('/api/settings/rates');
        currentRates = JSON.parse(data.value);
        return currentRates;
    } catch (error) {
        console.error('Error fetching rates:', error);
        // Fallback to default rates if API fails
        currentRates = {
            "Mutungo": 15000, "Luzira": 18000, "Bugolobi": 20000,
            "Naguru": 22000, "Nakawa": 12000, "Ntinda": 20000,
            "Kiwatule": 25000, "Banda": 15000
        };
        return currentRates;
    }
}

export async function renderReporterParishes() {
    const locationSelect = document.getElementById('locationSelect');
    if (!locationSelect) return;
    const rates = await fetchRates();
    
    const currentValue = locationSelect.value;
    locationSelect.innerHTML = '<option value="">Select Parish...</option>' + 
        Object.keys(rates).map(parish => `
            <option value="${parish}" data-fee="${rates[parish]}">${parish}</option>
        `).join('');
    locationSelect.value = currentValue;
}

export function updateCalculatedFee() {
    const locationSelect = document.getElementById('locationSelect');
    const quantityInput = document.getElementById('wasteQuantity');
    const unitSelect = document.getElementById('wasteUnit');
    const feeDisplay = document.getElementById('feeEstimate');

    if (!locationSelect || !quantityInput || !unitSelect) return { totalFee: 0, unitPrice: 0 };
    
    const selectedOption = locationSelect.options[locationSelect.selectedIndex];
    const unitPrice = parseFloat(selectedOption?.getAttribute('data-fee')) || 0;
    const quantity = parseFloat(quantityInput.value) || 0;
    const totalFee = unitPrice * quantity;

    if (feeDisplay) {
        feeDisplay.textContent = `Estimated Fee: UGX ${totalFee.toLocaleString()} (@ UGX ${unitPrice.toLocaleString()} per ${unitSelect.value || 'unit'})`;
    }
    return { totalFee, unitPrice };
}

export function setupRequestFormListeners() {
    const requestForm = document.getElementById('requestForm');
    const locationSelect = document.getElementById('locationSelect');
    const zoneSelect = document.getElementById('zoneSelect');
    const wasteTypeSelect = document.getElementById('wasteType');
    const quantityInput = document.getElementById('wasteQuantity');
    const unitSelect = document.getElementById('wasteUnit');

    if (requestForm) {
        requestForm.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('input', saveFormDraft);
        });
        loadFormDraft();
    }

    if (locationSelect && zoneSelect && wasteTypeSelect && quantityInput && unitSelect) {
        [locationSelect, quantityInput, unitSelect, wasteTypeSelect].forEach(el => {
            el.addEventListener('change', updateCalculatedFee);
            el.addEventListener('input', updateCalculatedFee);
        });

        locationSelect.addEventListener('change', () => {
            const parish = locationSelect.value.trim();
            if (parish && parishZones[parish]) {
                zoneSelect.disabled = false;
                zoneSelect.innerHTML = '<option value="">Select Zone...</option>' + 
                    parishZones[parish].map(zone => `<option value="${zone}">${zone}</option>`).join('');
            } else {
                zoneSelect.disabled = true;
                zoneSelect.innerHTML = '<option value="">Select Zone...</option>';
            }
        });
    }

    requestForm?.addEventListener('submit', handleRequestFormSubmit);
}

function saveFormDraft() {
    const draft = {
        plotNumber: document.getElementById('plotNumber')?.value,
        streetName: document.getElementById('streetName')?.value,
        locationSelect: document.getElementById('locationSelect')?.value,
        zoneSelect: document.getElementById('zoneSelect')?.value,
        wasteType: document.getElementById('wasteType')?.value,
        serviceDesc: document.getElementById('serviceDesc')?.value,
        wasteQuantity: document.getElementById('wasteQuantity')?.value,
        wasteUnit: document.getElementById('wasteUnit')?.value,
    };
    localStorage.setItem('bchain_request_draft', JSON.stringify(draft));
}

function loadFormDraft() {
    const savedDraft = JSON.parse(localStorage.getItem('bchain_request_draft'));
    if (!savedDraft) return;

    if (document.getElementById('plotNumber')) document.getElementById('plotNumber').value = savedDraft.plotNumber || '';
    if (document.getElementById('streetName')) document.getElementById('streetName').value = savedDraft.streetName || '';
    if (document.getElementById('serviceDesc')) document.getElementById('serviceDesc').value = savedDraft.serviceDesc || '';
    if (document.getElementById('wasteType')) document.getElementById('wasteType').value = savedDraft.wasteType || '';
    if (document.getElementById('wasteQuantity')) document.getElementById('wasteQuantity').value = savedDraft.wasteQuantity || '1';
    if (document.getElementById('wasteUnit')) document.getElementById('wasteUnit').value = savedDraft.wasteUnit || 'KGs';

    const locationSelect = document.getElementById('locationSelect');
    const zoneSelect = document.getElementById('zoneSelect');

    if (locationSelect && savedDraft.locationSelect) {
        locationSelect.value = savedDraft.locationSelect;
        locationSelect.dispatchEvent(new Event('change')); // Trigger zone population
        setTimeout(() => { if (zoneSelect) zoneSelect.value = savedDraft.zoneSelect || ''; updateCalculatedFee(); }, 50);
    }
}

async function handleRequestFormSubmit(e) {
    e.preventDefault();
    
    const wasteType = document.getElementById('wasteType').value;
    const collectors = await apiFetch('/api/collectors/active');
    
    if (collectors.length === 0) {
        return showToast("No active waste management companies are currently available. Please try again later.", "error");
    }

    const suitableCollectors = collectors.filter(c => c.collectorType === wasteType);

    if (suitableCollectors.length === 0) {
        return showToast(`No active ${wasteType} waste management companies are currently available.`, "error");
    }

    const picked = suitableCollectors[Math.floor(Math.random() * suitableCollectors.length)];
    currentlyAssignedCompany = { 
        name: picked.companyName || 'Unknown', 
        number: picked.contact || 'N/A', 
        username: picked.username 
    };

    const { totalFee } = updateCalculatedFee();
    const reportSummary = document.getElementById('reportSummary');
    const paymentModal = document.getElementById('paymentModal');

    reportSummary.innerHTML = `
        <p><strong>Location:</strong> Plot ${document.getElementById('plotNumber')?.value || 'N/A'}, ${document.getElementById('streetName')?.value || 'N/A'}</p>
        <p><strong>Parish/Zone:</strong> ${document.getElementById('locationSelect').value} (${document.getElementById('zoneSelect').value})</p>
        <p><strong>Waste Type:</strong> ${wasteType}</p>
        <p><strong>Quantity:</strong> ${document.getElementById('wasteQuantity').value} ${document.getElementById('wasteUnit').value}</p>
        <p style="font-size: 1.2em; color: #3F51B5; margin-top: 10px;"><strong>Total Due: UGX ${totalFee.toLocaleString()}</strong></p>
    `;
    
    paymentModal.classList.remove('hidden');
}

export function setupPaymentModalListeners() {
    const paymentModal = document.getElementById('paymentModal');
    const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
    const cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
    const mmDetails = document.getElementById('mobileMoneyDetails');
    const payMMRadio = document.getElementById('payMobileMoney');
    const payCashRadio = document.getElementById('payCash');
    const mmInput = document.getElementById('mobileMoneyNumber');
    const collectorPaymentInfo = document.getElementById('collectorPaymentInfo');
    const referenceSection = document.getElementById('referenceSection');
    const paymentMethodSection = document.getElementById('paymentMethodSection');

    if (payMMRadio) payMMRadio.addEventListener('change', () => mmDetails.classList.remove('hidden'));
    if (payCashRadio) payCashRadio.addEventListener('change', () => {
        mmDetails.classList.add('hidden');
        collectorPaymentInfo.classList.add('hidden');
    });

    if (mmInput) {
        mmInput.addEventListener('input', () => {
            if (mmInput.value.length >= 10 && currentlyAssignedCompany) {
                document.getElementById('targetCompanyName').textContent = currentlyAssignedCompany.name;
                document.getElementById('targetCompanyNumber').textContent = `Pay to: ${currentlyAssignedCompany.number}`;
                collectorPaymentInfo.classList.remove('hidden');
            } else {
                collectorPaymentInfo.classList.add('hidden');
            }
        });
    }

    if (cancelPaymentBtn) cancelPaymentBtn.addEventListener('click', () => {
        paymentModal.classList.add('hidden');
        referenceSection.classList.add('hidden');
        paymentMethodSection.classList.remove('hidden');
        confirmPaymentBtn.textContent = "Confirm Payment";
    });

    if (confirmPaymentBtn) confirmPaymentBtn.addEventListener('click', handleConfirmPayment);
}

async function handleConfirmPayment() {
    const method = document.querySelector('input[name="paymentMethod"]:checked')?.value;
    const mmNumber = document.getElementById('mobileMoneyNumber').value;
    const refNumber = document.getElementById('paymentReference').value;

    if (!method) {
        showToast("Please select a payment method (Mobile Money or Cash).", "info");
        return;
    }

    if (!currentlyAssignedCompany) {
        showToast("No collector assigned. Please restart the request.", "error");
        return;
    }

    if (method === 'mobileMoney' && !mmNumber) {
        showToast("Please enter your Mobile Money number to proceed.", "info");
        return;
    }

    const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
    const paymentMethodSection = document.getElementById('paymentMethodSection');
    const referenceSection = document.getElementById('referenceSection');
    const requestForm = document.getElementById('requestForm');
    const paymentModal = document.getElementById('paymentModal');
    const zoneSelect = document.getElementById('zoneSelect');
    const locationSelect = document.getElementById('locationSelect');
    const quantityInput = document.getElementById('wasteQuantity');
    const unitSelect = document.getElementById('wasteUnit');
    const feeDisplay = document.getElementById('feeEstimate');

    if (method === 'mobileMoney' && referenceSection.classList.contains('hidden')) {
        paymentMethodSection.classList.add('hidden');
        referenceSection.classList.remove('hidden');
        confirmPaymentBtn.textContent = "Finalize & Submit";
        return;
    }

    const { totalFee, unitPrice } = updateCalculatedFee();
    // adminCut will now be calculated on the backend for consistency
    
    const wasteRequestData = {
        collector_username: currentlyAssignedCompany.username,
        location: `Plot ${document.getElementById('plotNumber').value}, ${document.getElementById('streetName').value} (${zoneSelect.value})`,
        parish: locationSelect.value,
        zone: zoneSelect.value,
        street: document.getElementById('streetName').value,
        plotNumber: document.getElementById('plotNumber').value,
        wasteType: document.getElementById('wasteType').value,
        description: document.getElementById('serviceDesc').value,
        quantity: parseFloat(quantityInput.value),
        unit: unitSelect.value,
        unit_price: unitPrice,
        fee: totalFee, // Send totalFee, admin_cut will be derived from this on backend
        status: method === 'cash' ? 'Pending (Cash)' : 'Paid (mobileMoney)',
        paymentMethod: method,
        paymentRef: method === 'mobileMoney' ? refNumber : null,
        allocated_company_name: currentlyAssignedCompany.name,
        allocated_company_number: currentlyAssignedCompany.number
    };

    await apiFetch('/api/waste_requests', {
        method: 'POST',
        body: wasteRequestData,
    });
    
    showToast("Waste request submitted successfully!", "success");
    paymentModal.classList.add('hidden'); // Hide the payment modal
    requestForm.reset();
    localStorage.removeItem('bchain_request_draft');
    zoneSelect.disabled = true;
    feeDisplay.textContent = "Estimated Fee: UGX 0";
    
    referenceSection.classList.add('hidden');
    paymentMethodSection.classList.remove('hidden');
    confirmPaymentBtn.textContent = "Confirm Payment";
    switchView('view-overview');
    renderReporterHistory();
}

export async function renderReporterHistory() {
    const reporterList = document.getElementById('reporter-history-list');
    const currentUser = getCurrentUser();
    if (!reporterList || currentUser === 'anonymous') return;

    const history = await apiFetch('/api/waste_requests');
    const myReports = history.filter(item => item.reporter_username === currentUser);

    reporterList.innerHTML = myReports.map(item => `
        <tr>
            <td>${new Date(item.timestamp).toLocaleString()}</td>
            <td>${item.location}</td>
            <td>${item.waste_type}</td>
            <td>
                ${item.allocated_company ? 
                    `<strong>${item.allocated_company.name}</strong><br><small>${item.allocated_company.number}</small>` : 
                    '<span style="color:#999">Pending Allocation</span>'}
            </td>
            <td>UGX ${item.fee.toLocaleString()}</td>
            <td>
                <span class="status-badge ${getStatusClass(item.status)}">${item.status}</span>
                ${item.status === 'Completed' && !item.reporter_rating ? 
                    `<br><button onclick="window.openRatingModal('${item.id}', '${item.location.replace(/'/g, "\\'")}')" style="margin-top:5px; font-size:0.8em; cursor:pointer; background: #3F51B5; color:white; border:none; border-radius:3px; padding:2px 5px;">Rate Service</button>` : 
                    (item.reporter_rating ? `<br><small style="color:#FFD700;">Rated: ${item.reporter_rating} ★</small>` : '')
                }
                ${item.payment_ref ? `<br><small style="color:#666">Ref: ${item.payment_ref}</small>` : ''}
            </td>
        </tr>
    `).join('');

    const statFiled = document.getElementById('stat-filed');
    if (statFiled) statFiled.textContent = myReports.length;
    const statVerified = document.getElementById('stat-verified');
    if (statVerified) {
        const myVerifiedReports = myReports.filter(item => item.reporter_username === currentUser && item.status.includes('Completed'));
        statVerified.textContent = myVerifiedReports.length;
    }
}

export function handleFeedbackRedirect(target) {
    const messageView = document.getElementById('view-messages');
    if (messageView) {
        switchView('view-messages');
        if (window.selectChat) {
            window.selectChat(target);
            console.log(`Redirecting to chat with: ${target}`);
            const messageInput = document.querySelector('[id$="-message-input"]');
            if (messageInput) setTimeout(() => messageInput.focus(), 100);
        }
    }
}

export function setupReporterActions() {
    const feedbackAdminBtn = document.getElementById('feedbackAdminBtn');
    const feedbackCollectorBtn = document.getElementById('feedbackCollectorBtn');
    const reportAlertBtn = document.getElementById('reportAlertBtn');

    if (feedbackAdminBtn) feedbackAdminBtn.addEventListener('click', (e) => { e.preventDefault(); handleFeedbackRedirect('admin'); });
    if (feedbackCollectorBtn) feedbackCollectorBtn.addEventListener('click', (e) => { e.preventDefault(); handleFeedbackRedirect('collector'); });

    if (reportAlertBtn) {
        reportAlertBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openConfirmModal("Report Critical Issue", "Please describe the critical issue:", async (issueDetails) => {
                if (!issueDetails || issueDetails.trim() === "") return showToast("Issue report cannot be empty.", "info");
                // This would ideally send a message to the admin via API
                await apiFetch('/api/messages', {
                    method: 'POST',
                    body: { recipient: 'admin', content: `[CRITICAL ISSUE REPORTED by ${getCurrentUser()}]: ${issueDetails}` }
                });
                showToast("Critical issue reported to Admin. Thank you.", "success");
                updateUnreadCount(getCurrentUser()); // Update unread count for admin
            }, true);
        });
    }
}