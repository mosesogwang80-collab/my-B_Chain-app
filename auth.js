import { apiFetch } from './api.js'; // Correct path
import { showToast } from './ui.js'; // Correct path

let currentUser = localStorage.getItem('currentUser') || 'anonymous';
let userRole = localStorage.getItem('userRole') || 'anonymous';
let systemStatus = 'on'; // Will be fetched from backend

export function getCurrentUser() { return currentUser; }
export function getUserRole() { return userRole; }
export function getSystemStatus() { return systemStatus; }

export async function fetchCurrentUserAndRole() {
    try {
        const data = await apiFetch('/api/current_user', { silent: true });
        currentUser = data.username || 'anonymous';
        userRole = data.role || 'anonymous';
        localStorage.setItem('currentUser', currentUser);
        localStorage.setItem('userRole', userRole);
        
        // Update display after fetching
        const collectorDisplay = document.getElementById('collector-user-display');
        if (collectorDisplay) collectorDisplay.textContent = currentUser;
        
        await fetchSystemStatus(); // Fetch system status after user role is known
        checkMaintenanceMode();
    } catch (error) {
        console.error('Error fetching current user:', error);
        // If fetching current user fails, ensure we're treated as anonymous
        currentUser = 'anonymous';
        userRole = 'anonymous';
        localStorage.removeItem('currentUser');
        localStorage.removeItem('userRole');
    }
}

export async function fetchSystemStatus() {
    try {
        const data = await apiFetch('/api/settings/system_status');
        systemStatus = data.value;
    } catch (error) {
        console.error('Error fetching system status:', error);
        systemStatus = 'on'; // Default to 'on' if status cannot be fetched
    }
}

export function checkMaintenanceMode() {
    const isMaintenancePage = window.location.pathname.includes('maintenance.html');
    if (isMaintenancePage) return;

    const isDashboard = window.location.pathname.includes('_dashboard.html');
    const isLandingPage = window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/') || window.location.pathname === '';
    
    if (systemStatus === 'off' && userRole !== 'Admin' && (isDashboard || isLandingPage)) {
        window.location.href = 'maintenance.html';
    }
}

export async function handleLogin(formData) {
    const data = await apiFetch('/login', {
        method: 'POST',
        body: formData,
    });
    localStorage.setItem('currentUser', data.username);
    localStorage.setItem('userRole', data.role);
    if (data.role === 'Admin') window.location.href = 'admin_dashboard.html';
    else if (data.role === 'Collector') window.location.href = 'collector_dashboard.html';
    else window.location.href = 'reporter_dashboard.html';
}

export async function handleRegistration(formData) {
    await apiFetch('/register', {
        method: 'POST',
        body: formData,
    });
    showToast("Registration successful! Please wait for Admin approval.", "info");
    setTimeout(() => { window.location.href = 'login.html'; }, 3000);
}

export async function handlePasswordReset(formData) {
    const data = await apiFetch('/api/reset_password', {
        method: 'POST',
        body: formData,
    });
    showToast(data.message, "success");
    setTimeout(() => { window.location.href = 'login.html'; }, 3000);
}

export async function logout() {
    await apiFetch('/api/logout', { method: 'POST' });
    localStorage.removeItem('currentUser');
    localStorage.removeItem('userRole');
    window.location.href = 'index.html';
}

export async function renderProfile() {
    const data = await apiFetch('/api/profile');
    return data;
}

export async function updateProfile(formData) {
    const data = await apiFetch('/api/profile', {
        method: 'POST',
        body: formData,
    });
    showToast(data.message, "success");
    return data;
}