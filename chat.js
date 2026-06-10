import { apiFetch } from './api.js';
import { showToast, escapeHTML } from './ui.js';
import { openConfirmModal } from './ui.js';

let activeChat = null;

export async function updateUnreadCount(currentUser, silent = false) {
    const messages = await apiFetch('/api/messages', { silent: true });
    
    // Calculate total unread including both user messages and system notifications
    const totalUnread = messages.filter(m => m.recipient === currentUser && !m.read).length;
    
    const unreadBadges = document.querySelectorAll('.unread-badge');
    
    unreadBadges.forEach(badge => {
        // Only update global/navigation badges here. 
        // Badges inside '.chat-item' are handled by renderChatList.
        if (!badge.closest('.chat-item')) {
            if (totalUnread > 0) {
                badge.textContent = totalUnread;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    });
}

export async function renderChatList(currentUser, userRole) {
    const chatList = document.querySelector('[id$="-chat-list"]');
    if (!chatList) return;

    const messages = await apiFetch('/api/messages');
    const requests = await apiFetch('/api/waste_requests');
    const allUsers = userRole === 'Admin' ? await apiFetch('/api/users') : [];
    
    let chatPartnersMap = new Map();

    // Always include System as a partner so users can view notification history
    chatPartnersMap.set('System', { username: 'System', role: 'System' });

    if (userRole === 'Admin') {
        allUsers.filter(user => user.username !== currentUser)
                .forEach(user => chatPartnersMap.set(user.username, user));
    } else {
        chatPartnersMap.set('admin', { username: 'admin', role: 'Admin' });
        requests.forEach(req => {
            if (userRole === 'Reporter' && req.collector_username) {
                chatPartnersMap.set(req.collector_username, { username: req.collector_username, role: 'Collector' });
            } else if (userRole === 'Collector' && req.reporter_username) {
                chatPartnersMap.set(req.reporter_username, { username: req.reporter_username, role: 'Reporter' });
            }
        });
    }

    chatList.innerHTML = Array.from(chatPartnersMap.values())
        .map(user => {
            const unread = messages.filter(m => m.sender === user.username && m.recipient === currentUser && !m.read).length;
            return `
                <div class="chat-item ${user.username === 'System' ? 'chat-item-system' : ''} ${activeChat === user.username ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}" onclick="window.selectChat('${user.username}')">
                    <span class="chat-item-name">${user.username}</span>
                    <small>(${user.role})</small>
                    ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
                </div>
            `;
        }).join('');
}

export async function renderMessages(currentUser) {
    const chatMessages = document.querySelector('[id$="-chat-messages"]');
    if (!chatMessages || !activeChat) return;

    const chat = await apiFetch(`/api/messages?partner=${activeChat}`);
    const newHTML = chat.map(m => `
        <div class="chat-message ${m.sender === currentUser ? 'sent' : 'received'}" id="msg-${m.id}">
            <div class="message-content">${escapeHTML(m.content)}</div>
            <div class="message-actions">
                <span class="action-btn delete-btn" onclick="window.deleteMessage('${m.id}')">Delete</span>
            </div>
        </div>
    `).join('');

    // Only update DOM if content has changed to prevent flickering
    if (chatMessages.innerHTML !== newHTML) {
        // Detect if user is already at the bottom before updating
        const isAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;
        
        chatMessages.innerHTML = newHTML;

        if (isAtBottom) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
}

export const selectChat = async (username) => { // Exported and then exposed globally in main.js
    activeChat = username;
    // Update chat headers across all potential dashboards
    document.querySelectorAll('[id$="-current-chat-name"]').forEach(header => {
        header.textContent = `Chat with: ${username}`;
    });
    
    await apiFetch(`/api/messages?partner=${username}`);
    const currentUser = localStorage.getItem('currentUser');
    const userRole = localStorage.getItem('userRole');
    
    renderChatList(currentUser, userRole);
    renderMessages(currentUser);
    updateUnreadCount(currentUser);
};

export const sendMessage = async () => { // Exported and then exposed globally in main.js
    // Find the message input that is currently visible in the active dashboard view
    const activeView = document.querySelector('.dashboard-view:not(.hidden)');
    if (!activeView) return;

    const activeInput = activeView.querySelector('[id$="-message-input"]');
    if (!activeInput) return;

    const content = activeInput?.value;
    if (!activeChat) {
        showToast("Please select a contact first.", "info");
        return;
    }
    
    if (!content?.trim()) return;

    await apiFetch('/api/messages', {
        method: 'POST',
        body: { recipient: activeChat, content: content }
    });
    
    activeInput.value = '';
    renderMessages(localStorage.getItem('currentUser'));
};

export const deleteMessage = (id) => { // Exported and then exposed globally in main.js
    openConfirmModal("Delete Message", "Are you sure you want to delete this message?", async () => {
        await apiFetch(`/api/messages/${id}`, {
            method: 'DELETE',
        });
        await renderMessages(localStorage.getItem('currentUser'));
        await updateUnreadCount(localStorage.getItem('currentUser'));
    });
};

export const replyToMessage = (sender) => { // Exported and then exposed globally in main.js
    const messageInput = document.querySelector('[id$="-message-input"]');
    if (messageInput) {
        messageInput.value = `@${sender} `;
        messageInput.focus();
    }
};

// --- Real-Time WebSocket Logic ---
let socket = null;

export function startRealTimeChat() {
    if (socket) return; // Already connected

    // io() is provided by the socket.io client script added to the HTML
    socket = io();

    socket.on('connect', () => {
        console.log("Connected to real-time messaging server.");
    });

    socket.on('new_message', async (msg) => {
        const currentUser = localStorage.getItem('currentUser');
        const userRole = localStorage.getItem('userRole');

        // 1. Show a toast if it's a message for the current user
        if (msg.recipient === currentUser && msg.sender !== 'System') {
            showToast(`New message from ${msg.sender}`, "info");
        }
        
        // Show toast for system updates, but do NOT auto-read them anymore
        // This allows the unread count to stay visible on the navigation tab
        if (msg.recipient === currentUser && msg.sender === 'System') {
             showToast(msg.content, "info");
        }

        // 2. Refresh the UI if the user is currently looking at the message view
        const messageView = document.getElementById('view-messages');
        if (messageView && !messageView.classList.contains('hidden')) {
            await renderChatList(currentUser, userRole);
            if (activeChat) await renderMessages(currentUser);
        }

        // 3. Update the unread badge silently (we already handled the toast)
        await updateUnreadCount(currentUser, true);
    });

    socket.on('task_status_update', async (data) => {
        const currentUser = localStorage.getItem('currentUser');
        const userRole = localStorage.getItem('userRole');
        
        showToast(`Task update: A request has been marked as ${data.status}`, "success");
        
        // Refresh relevant views
        if (window.renderReporterHistory) await window.renderReporterHistory();
    });
}