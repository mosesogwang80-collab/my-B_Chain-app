import { apiFetch } from './api.js';
import { showToast, openConfirmModal, switchView, escapeHTML, getStatusClass, setupRatingModal, openRatingModal, printRecords, exportToPDF, exportToExcel } from './ui.js';
import { updateUnreadCount, renderChatList, renderMessages, selectChat, sendMessage, deleteMessage, replyToMessage, startRealTimeChat } from './chat.js';
import { renderAnalytics, renderUserList, setupSystemControlListeners, renderAdminRates, fetchAdminMM, saveAdminMM, renderAdminAlerts, clearAllRecords, adminEditRate, adminDeleteRate, adminAddRate, renderAdminLogs, renderAdminFinancialSummary, renderAdminWithdrawalHistory, handleWithdrawFees, recalculateAdminCuts } from './admin.js';
import { renderAvailableTasks, renderCollectorHistory, renderActiveTasks, setupCollectorTaskListeners, setupCollectorMMListeners, setupDebtSettlementListener, setupAvailabilityToggle } from './collector.js';
import { fetchCurrentUserAndRole, getCurrentUser, getUserRole, getSystemStatus, checkMaintenanceMode, handleLogin, handleRegistration, handlePasswordReset, logout, renderProfile, updateProfile } from './auth.js';
import { renderReporterParishes, setupRequestFormListeners, setupPaymentModalListeners, renderReporterHistory, setupReporterActions, updateCalculatedFee } from './reporter.js';

// Expose to window for legacy HTML onclick handlers
window.apiFetch = apiFetch;
window.showToast = showToast;
window.openConfirmModal = openConfirmModal;
window.switchView = switchView;
window.escapeHTML = escapeHTML; // Added for completeness if needed
window.getStatusClass = getStatusClass; // Added for completeness if needed
window.openRatingModal = openRatingModal;
window.logout = logout; // Expose logout globally
window.printRecords = printRecords;
window.exportToPDF = exportToPDF;
window.exportToExcel = exportToExcel;
window.selectChat = selectChat; // Expose chat functions
window.sendMessage = sendMessage;
window.deleteMessage = deleteMessage;
window.replyToMessage = replyToMessage;

// Admin specific global functions
window.approveUser = (username) => openConfirmModal("Approve User", `Approve "${username}"?`, async () => { await apiFetch(`/api/users/${username}/approve`, { method: 'POST' }); showToast(`User ${username} approved.`); renderUserList(); });
window.rejectUser = (username) => openConfirmModal("Reject User", `Are you sure you want to reject and delete user "${username}"?`, async () => { await apiFetch(`/api/users/${username}/reject`, { method: 'POST' }); showToast(`User ${username} rejected and deleted.`); renderUserList(); renderAdminAlerts(); });
window.toggleUserStatus = (username) => openConfirmModal("Toggle Status", `Change status for "${username}"?`, async () => { const data = await apiFetch(`/api/users/${username}/toggle_status`, { method: 'POST' }); showToast(data.message); renderUserList(); });
window.deleteUser = (username) => openConfirmModal("Delete User", `Are you sure you want to permanently delete user "${username}"?`, async () => { await apiFetch(`/api/users/${username}/delete`, { method: 'DELETE' }); showToast(`User ${username} deleted.`); renderUserList(); });
window.editRate = adminEditRate; // Delegated to admin.js
window.deleteRate = adminDeleteRate; // Delegated to admin.js
window.addRate = adminAddRate; // Delegated to admin.js
window.renderAdminLogs = renderAdminLogs; // Expose admin logs function
window.clearAllRecords = clearAllRecords; // Expose clear all records function

window.recalculateAdminCuts = recalculateAdminCuts; // Expose recalculation function
window.handleWithdrawFees = handleWithdrawFees; // Expose admin withdrawal function
// Reporter specific global functions
window.updateCalculatedFee = updateCalculatedFee; // Expose for direct HTML calls if any
window.renderReporterHistory = renderReporterHistory; // Expose for direct calls if any

// Collector specific global functions
window.renderCollectorHistory = renderCollectorHistory; // Expose for direct calls if any

// Expose Landing Content helpers at top level to ensure they are available immediately
window.showLandingContent = function() {
    const content = document.getElementById('about');
    if (content) {
        const heroSection = document.querySelector('.hero-section');
        if (heroSection) heroSection.classList.add('hidden');
        content.classList.remove('hidden');
        content.scrollIntoView({ behavior: 'smooth' });
    }
};

window.hideLandingContent = function() {
    const content = document.getElementById('about');
    if (content) {
        const heroSection = document.querySelector('.hero-section');
        if (heroSection) heroSection.classList.remove('hidden');
        content.classList.add('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

window.openSafetyNotice = function() {
    const modal = document.getElementById('safetyNoticeModal');
    if (modal) modal.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    setupRatingModal();
    setupCollectorTaskListeners();
    setupCollectorMMListeners();
    setupDebtSettlementListener();
    setupRequestFormListeners();
    setupPaymentModalListeners();
    setupReporterActions();
    setupAvailabilityToggle(); // Collector specific availability

    // Messaging event listeners using delegation for better reliability
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id && e.target.id.endsWith('-send-message-btn')) {
            window.sendMessage();
        }
    });

    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && e.target && e.target.id && e.target.id.endsWith('-message-input')) {
            e.preventDefault();
            await window.sendMessage();
        }
    });

    const chatSelector = document.querySelector('[id$="-chat-selector"]');
    if (chatSelector) {
        chatSelector.addEventListener('change', (e) => {
            if (e.target.value) window.selectChat(e.target.value);
        });
    }

    // Display identity on dashboards
    const collectorDisplay = document.getElementById('collector-user-display');
    if (collectorDisplay) collectorDisplay.textContent = getCurrentUser();

    // --- Session Persistence & Logout ---
    // Only auto-redirect from the root or login page if a session exists
    const shouldAutoRedirect = window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('/') || window.location.pathname === '';
    
    if (getCurrentUser() !== 'anonymous' && shouldAutoRedirect) {
        if (getUserRole() === 'Admin') {
            window.location.href = 'admin_dashboard.html';
        } else if (getUserRole() === 'Collector') {
            window.location.href = 'collector_dashboard.html';
        } else if (getUserRole() === 'Reporter') {
            window.location.href = 'reporter_dashboard.html';
        }
    }
    const regForm = document.getElementById('registrationForm');
    const loginForm = document.getElementById('loginForm');
    const accountTypeSelect = document.getElementById('accountType');
    const companyFields = document.getElementById('companyFields');

    if (accountTypeSelect && companyFields) {
        accountTypeSelect.addEventListener('change', () => {
            if (accountTypeSelect.value === 'Collector') {
                companyFields.classList.remove('hidden');
            } else {
                companyFields.classList.add('hidden');
            }
        });
    }
    
    if (regForm) {
        regForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = {
            username: document.getElementById('username').value,
            fullName: document.getElementById('fullName')?.value || document.getElementById('username').value,
            password: document.getElementById('password').value,
            role: document.getElementById('accountType').value,
            collectorType: document.getElementById('collectorType')?.value || '',
            companyName: document.getElementById('companyName')?.value || '',
            location: document.getElementById('location')?.value || '',
            contact: document.getElementById('contact')?.value || ''
        };

        if (!formData.username || !formData.password || !formData.contact || !formData.location) {
            return showToast("Please fill in all required fields (Username, Password, Contact, and Location).", "info");
        }

        if (formData.role === 'Collector' && !formData.companyName) {
            return showToast("Company Name is required for Collector registration.", "info");
        }

        handleRegistration(formData);
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = {
                username: document.getElementById('username').value,
                password: document.getElementById('password').value
            };

            handleLogin(formData);
        });
    }

    // Profile Management Logic
    const profileForm = document.getElementById('profileForm');
    const profileCompanyFields = document.getElementById('profileCompanyFields');
    const editProfileBtn = document.getElementById('editProfileBtn');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

    async function renderUserProfile() {
        if (!profileForm) return;
        
        const profileFullName = document.getElementById('profileFullName');
        const profileUsername = document.getElementById('profileUsername');
        const profileRole = document.getElementById('profileRole');
        const profileContact = document.getElementById('profileContact');
        const profileLocation = document.getElementById('profileLocation');
        const profileCompanyName = document.getElementById('profileCompanyName');

        try {
            const data = await renderProfile(); // Calls the renderProfile from auth.js

            if (profileFullName) profileFullName.value = data.fullName || '';
            profileUsername.value = data.username;
            profileRole.value = data.role;
            profileContact.value = data.contact || '';
            profileLocation.value = data.location || '';

            if (data.role === 'Collector') {
                profileCompanyFields.classList.remove('hidden');
                profileCompanyName.value = data.companyName || '';
            } else {
                profileCompanyFields.classList.add('hidden');
            }

            toggleEditMode(false);
        } catch (error) {
            console.error('Error fetching profile data:', error);
            showToast("Failed to load profile data.", "error");
        }
    }

    function toggleEditMode(isEditing) {
        if (!profileForm) return;
        // Unlock fields (except username and role which are permanent)
        const inputs = profileForm.querySelectorAll('input:not(#profileUsername):not(#profileRole)');
        inputs.forEach(input => input.disabled = !isEditing);

        if (isEditing) {
            editProfileBtn?.classList.add('hidden');
            saveProfileBtn?.classList.remove('hidden');
            cancelEditBtn?.classList.remove('hidden');
        } else {
            editProfileBtn?.classList.remove('hidden');
            saveProfileBtn?.classList.add('hidden');
            cancelEditBtn?.classList.add('hidden');
        }
    }

    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', () => toggleEditMode(true));
    }

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => renderUserProfile());
    }

    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = {
                fullName: document.getElementById('profileFullName').value,
                contact: document.getElementById('profileContact').value,
                location: document.getElementById('profileLocation').value,
            };

            if (!profileCompanyFields.classList.contains('hidden')) {
                formData.companyName = document.getElementById('profileCompanyName').value;
            }

            await updateProfile(formData); // Calls updateProfile from auth.js
            renderUserProfile(); // Re-render to show updated data
        });
    }

    // Dashboard Navigation Logic
    const sidebarLinks = document.querySelectorAll('.sidebar-link, .nav-link');
    const views = document.querySelectorAll('.dashboard-view');
    const quickReportBtn = document.getElementById('quickReportBtn');
    const backBtn = document.getElementById('globalBackBtn');

    window.switchView = function(targetId) {
        const homeViews = ['admin-overview', 'view-tasks', 'view-overview'];
        if (backBtn) {
            if (homeViews.includes(targetId)) {
                backBtn.classList.add('hidden');
            } else {
                backBtn.classList.remove('hidden');
            }
        }
        views.forEach(view => {
            view.classList.add('hidden');
        });
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
            targetElement.classList.remove('hidden');
            // Jump to the top of the new view immediately
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        sidebarLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-target') === targetId) {
                link.classList.add('active');
            }
        });

        // Auto-refresh data based on view
        if (targetId === 'admin-users') renderUserList();
        if (targetId === 'admin-logs') renderAdminLogs();
        if (targetId === 'admin-overview') {
            renderAnalytics();
            renderAdminAlerts();
            renderAdminLogs(); // Ensure revenue stats are updated on the dashboard
            renderAdminFinancialSummary(); // Update financial summary
            renderAdminWithdrawalHistory(); // Update withdrawal history
        }
        if (targetId === 'admin-settings') { // Admin rates
            renderAdminRates();
            fetchAdminMM();
        }
        if (targetId === 'profile-view') renderUserProfile();
        if (targetId === 'view-tasks') {
            renderAvailableTasks();
            renderActiveTasks();
        }
        if (targetId === 'view-history' && getUserRole() === 'Reporter') renderReporterHistory();
        if (targetId === 'view-history' && getUserRole() === 'Collector') renderCollectorHistory();
        if (targetId === 'view-messages') { // Chat
            renderChatList(getCurrentUser(), getUserRole()); // Pass current user and role
        }
    };

    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            let homeId = 'view-overview'; // Reporter default
            if (getUserRole() === 'Admin') homeId = 'admin-overview';
            else if (getUserRole() === 'Collector') homeId = 'view-tasks';
            switchView(homeId);
        });
    }

    // Only bind to links that actually have a data-target
    document.querySelectorAll('[data-target]').forEach(link => {
        link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('data-target');
            e.preventDefault();
            switchView(targetId);
            
            // Force the dropdown menu to close after clicking an item
            const dropdown = link.closest('.nav-dropdown');
            const content = link.closest('.nav-dropdown-content');
            if (content) {
                content.style.display = 'none';
                setTimeout(() => { content.style.removeProperty('display'); }, 200);
            }
        });
    });

    if (quickReportBtn) {
        quickReportBtn.addEventListener('click', () => {
            switchView('view-submit');
        });
    }

    // Admin Dashboard Stat Card Clicks
    const statCardUsers = document.getElementById('stat-card-users');
    const statCardRevenue = document.getElementById('stat-card-revenue');
    const statCardHistory = document.getElementById('stat-card-history');

    if (statCardUsers) statCardUsers.addEventListener('click', () => switchView('admin-users'));
    if (statCardRevenue) statCardRevenue.addEventListener('click', () => switchView('admin-logs'));
    if (statCardHistory) statCardHistory.addEventListener('click', () => switchView('admin-logs'));

    const clearAllBtn = document.getElementById('clearAllRecordsBtn');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAllRecords); // Delegated to admin.js
    }

    async function initializeApp() { // This is the main entry point for dashboard logic
        const publicPages = ['index.html', 'login.html', 'register.html', 'forgot_password.html', 'maintenance.html'];
        const isPublicPage = publicPages.some(page => 
            window.location.pathname.endsWith(page) || window.location.pathname.endsWith(page.replace('.html', ''))
        ) || window.location.pathname === '/' || window.location.pathname === '';

        // Only fetch current user if we are NOT on a public page, or if we need to check for auto-redirect
        if (!isPublicPage) {
            await fetchCurrentUserAndRole();
        }

        // Get fresh values after the fetch check
        let currentUserRole = getUserRole();
        let currentUserName = getCurrentUser();

        if (currentUserRole === 'Reporter' && !isPublicPage) {
            await renderReporterParishes(); // Populate parish dropdown
            renderReporterHistory(); // Render reporter's history
            updateCalculatedFee(); // Initial fee calculation for the form
        } else if (currentUserRole === 'Collector' && !isPublicPage) {
            renderAvailableTasks(); // Render tasks available to collector
            renderActiveTasks(); // Render tasks accepted by collector
            renderCollectorHistory(); // Render collector's history
            // setupCollectorMMListeners(); // Already called at top of DOMContentLoaded
            // setupDebtSettlementListener(); // Already called at top of DOMContentLoaded
        } else if (currentUserRole === 'Admin' && !isPublicPage) {
            renderAdminRates(); // Render admin rates
            renderUserList(); // Render user list
            renderAnalytics(); // Render analytics
            fetchAdminMM(); // Fetch admin mobile money
            renderAdminAlerts(); // Render admin alerts
            renderAdminLogs(); // Ensure revenue stats are updated on initial dashboard load
            renderAdminFinancialSummary(); // Initial load for financial summary
            renderAdminWithdrawalHistory(); // Initial load for withdrawal history
            setupSystemControlListeners(); // Admin specific, needs to be called here
        }

        // Common initializations
        if (!isPublicPage && currentUserName !== 'anonymous') {
        renderChatList(currentUserName, currentUserRole); // Render chat list for all roles
        updateUnreadCount(currentUserName); // Update unread count for all roles
        startRealTimeChat(); // Initialize WebSocket connection
        }
        if (window.location.pathname.includes('profile.html')) renderUserProfile();
    }
    initializeApp();
});