// Global variables
let currentUser = null;
let currentSocket = null;
let currentChatId = null;
let currentProduct = null;
let typingTimeout = null;

// API base URL
const API_URL = window.location.origin;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    loadProducts();
});

// Check authentication
function checkAuth() {
    const token = localStorage.getItem('token');
    if (token) {
        fetch(`${API_URL}/api/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(user => {
            if (!user.error) {
                currentUser = user;
                showUserMenu();
                connectSocket();
                loadUserChats();
            } else {
                logout();
            }
        })
        .catch(() => logout());
    }
}

// Connect to socket.io
function connectSocket() {
    const token = localStorage.getItem('token');
    currentSocket = io(API_URL, {
        auth: { token }
    });
    
    currentSocket.on('connect', () => {
        console.log('Socket connected');
    });
    
    currentSocket.on('new_message', (message) => {
        if (currentChatId === message.chatId) {
            displayMessage(message);
        }
        loadUserChats();
    });
    
    currentSocket.on('message_notification', (data) => {
        showNotification(`New message about ${data.productTitle}`);
        loadUserChats();
    });
    
    currentSocket.on('user_typing', (data) => {
        showTypingIndicator(data.isTyping);
    });
    
    currentSocket.on('user_status', (data) => {
        updateUserStatus(data.userId, data.status);
    });
}

// Show user menu
function showUserMenu() {
    document.getElementById('authLinks').style.display = 'none';
    document.getElementById('userMenu').style.display = 'flex';
    document.getElementById('userName').textContent = currentUser.fullName;
    document.getElementById('userAvatar').src = currentUser.avatar;
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('homeLink').addEventListener('click', (e) => {
        e.preventDefault();
        showView('products');
        loadProducts();
    });
    
    document.getElementById('sellLink').addEventListener('click', (e) => {
        e.preventDefault();
        if (!currentUser) {
            showLoginModal();
            return;
        }
        showView('sell');
    });
    
    document.getElementById('messagesLink').addEventListener('click', (e) => {
        e.preventDefault();
        if (!currentUser) {
            showLoginModal();
            return;
        }
        showView('messages');
        loadUserChats();
    });
    
    document.getElementById('myProductsLink').addEventListener('click', (e) => {
        e.preventDefault();
        if (!currentUser) {
            showLoginModal();
            return;
        }
        showView('myProducts');
        loadMyProducts();
    });
    
    document.getElementById('loginBtn').addEventListener('click', showLoginModal);
    document.getElementById('registerBtn').addEventListener('click', showRegisterModal);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('searchBtn').addEventListener('click', searchProducts);
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchProducts();
    });
    
    document.getElementById('sellForm').addEventListener('submit', submitProduct);
    document.getElementById('loginForm').addEventListener('submit', login);
    document.getElementById('registerForm').addEventListener('submit', register);
    document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById('messageInput').addEventListener('input', handleTyping);
    
    // Modal close buttons
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.style.display = 'none';
            });
        });
    });
}

// Show different views
function showView(view) {
    document.getElementById('productsView').style.display = 'none';
    document.getElementById('sellView').style.display = 'none';
    document.getElementById('messagesView').style.display = 'none';
    document.getElementById('myProductsView').style.display = 'none';
    
    if (view === 'products') {
        document.getElementById('productsView').style.display = 'grid';
    } else if (view === 'sell') {
        document.getElementById('sellView').style.display = 'block';
    } else if (view === 'messages') {
        document.getElementById('messagesView').style.display = 'grid';
    } else if (view === 'myProducts') {
        document.getElementById('myProductsView').style.display = 'block';
    }
}

// Load products
function loadProducts(category = 'all', search = '') {
    let url = `${API_URL}/api/products`;
    const params = [];
    if (category !== 'all') params.push(`category=${category}`);
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (params.length) url += `?${params.join('&')}`;
    
    fetch(url)
        .then(res => res.json())
        .then(products => {
            displayProducts(products);
        });
}

// Display products
function displayProducts(products) {
    const container = document.getElementById('productsView');
    if (!products.length) {
        container.innerHTML = '<p style="text-align: center;">No products found</p>';
        return;
    }
    
    container.innerHTML = products.map(product => `
        <div class="product-card" onclick="showProductDetail('${product.id}')">
            <img src="${product.images[0] || '/uploads/default.jpg'}" alt="${product.title}" class="product-image">
            <div class="product-info">
                <div class="product-title">${escapeHtml(product.title)}</div>
                <div class="product-price">$${product.price.toFixed(2)}</div>
                <div class="product-seller">
                    <img src="${product.seller.avatar}" class="seller-avatar">
                    <span>${escapeHtml(product.seller.fullName)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Show product detail
window.showProductDetail = async function(productId) {
    const response = await fetch(`${API_URL}/api/products/${productId}`);
    const product = await response.json();
    currentProduct = product;
    
    const modal = document.getElementById('productModal');
    const detailDiv = document.getElementById('productDetail');
    
    detailDiv.innerHTML = `
        <h2>${escapeHtml(product.title)}</h2>
        <img src="${product.images[0]}" style="max-width: 100%; border-radius: 8px; margin: 1rem 0;">
        <p><strong>Price:</strong> $${product.price.toFixed(2)}</p>
        <p><strong>Category:</strong> ${product.category}</p>
        <p><strong>Condition:</strong> ${product.condition}</p>
        <p><strong>Description:</strong></p>
        <p>${escapeHtml(product.description)}</p>
        <p><strong>Seller:</strong> ${escapeHtml(product.seller.fullName)}</p>
        ${currentUser && currentUser.id !== product.seller.id ? 
            `<button onclick="startChat('${product.id}')" class="btn-primary" style="margin-top: 1rem;">
                <i class="fas fa-comment"></i> Contact Seller
            </button>` : ''
        }
    `;
    
    modal.style.display = 'block';
};

// Start chat
window.startChat = async function(productId) {
    if (!currentUser) {
        showLoginModal();
        return;
    }
    
    const response = await fetch(`${API_URL}/api/chats`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
            productId: productId,
            buyerId: currentUser.id
        })
    });
    
    const chat = await response.json();
    document.getElementById('productModal').style.display = 'none';
    showView('messages');
    loadUserChats();
    setTimeout(() => openChat(chat.id), 500);
};

// Load user chats
async function loadUserChats() {
    if (!currentUser) return;
    
    const response = await fetch(`${API_URL}/api/chats`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const chats = await response.json();
    
    const chatsList = document.getElementById('chatsList');
    if (!chats.length) {
        chatsList.innerHTML = '<p style="text-align: center;">No conversations yet</p>';
        return;
    }
    
    chatsList.innerHTML = chats.map(chat => `
        <div class="chat-item" onclick="openChat('${chat.id}')">
            <div style="font-weight: 600;">${escapeHtml(chat.otherUser.fullName)}</div>
            <div style="font-size: 0.85rem; color: #666;">${escapeHtml(chat.productTitle)}</div>
            <div style="font-size: 0.8rem; color: #999;">
                ${chat.lastMessage ? chat.lastMessage.message.substring(0, 50) : 'No messages yet'}
            </div>
        </div>
    `).join('');
}

// Open chat
window.openChat = async function(chatId) {
    currentChatId = chatId;
    
    const response = await fetch(`${API_URL}/api/chats/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const messages = await response.json();
    
    const chats = await fetch(`${API_URL}/api/chats`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const allChats = await chats.json();
    const chat = allChats.find(c => c.id === chatId);
    
    document.getElementById('chatHeader').innerHTML = `
        <h3>Chat with ${escapeHtml(chat.otherUser.fullName)}</h3>
        <p style="font-size: 0.9rem; color: #666;">About: ${escapeHtml(chat.productTitle)}</p>
    `;
    
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = messages.map(msg => `
        <div class="message ${msg.senderId === currentUser.id ? 'message-sent' : 'message-received'}">
            <div>${escapeHtml(msg.message)}</div>
            <div class="message-time">${new Date(msg.timestamp).toLocaleString()}</div>
        </div>
    `).join('');
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    document.getElementById('chatInput').style.display = 'flex';
    
    if (currentSocket) {
        currentSocket.emit('join_chat', chatId);
    }
};

// Send message
async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message || !currentChatId) return;
    
    currentSocket.emit('send_message', {
        chatId: currentChatId,
        message: message
    });
    
    messageInput.value = '';
}

// Display message
function displayMessage(message) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.senderId === currentUser.id ? 'message-sent' : 'message-received'}`;
    messageDiv.innerHTML = `
        <div>${escapeHtml(message.message)}</div>
        <div class="message-time">${new Date(message.timestamp).toLocaleString()}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Handle typing
function handleTyping() {
    if (typingTimeout) clearTimeout(typingTimeout);
    currentSocket.emit('typing', { chatId: currentChatId, isTyping: true });
    typingTimeout = setTimeout(() => {
        currentSocket.emit('typing', { chatId: currentChatId, isTyping: false });
    }, 1000);
}

// Show typing indicator
function showTypingIndicator(isTyping) {
    const indicator = document.querySelector('.typing-indicator');
    if (isTyping && !indicator) {
        const div = document.createElement('div');
        div.className = 'typing-indicator';
        div.textContent = 'Someone is typing...';
        document.getElementById('chatMessages').appendChild(div);
    } else if (!isTyping && indicator) {
        indicator.remove();
    }
}

// Update user status
function updateUserStatus(userId, status) {
    // Update UI to show online/offline status
    const statusElement = document.querySelector(`[data-user-id="${userId}"] .status`);
    if (statusElement) {
        statusElement.textContent = status === 'online' ? '● Online' : '○ Offline';
        statusElement.style.color = status === 'online' ? '#10B981' : '#999';
    }
}

// Submit product
async function submitProduct(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const response = await fetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData
    });
    
    if (response.ok) {
        alert('Product listed successfully!');
        e.target.reset();
        showView('products');
        loadProducts();
    } else {
        alert('Error listing product');
    }
}

// Load my products
async function loadMyProducts() {
    const response = await fetch(`${API_URL}/api/my-products`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const products = await response.json();
    
    const container = document.getElementById('myProductsGrid');
    if (!products.length) {
        container.innerHTML = '<p>You haven\'t listed any products yet.</p>';
        return;
    }
    
    container.innerHTML = products.map(product => `
        <div class="product-card">
            <img src="${product.images[0]}" class="product-image">
            <div class="product-info">
                <div class="product-title">${escapeHtml(product.title)}</div>
                <div class="product-price">$${product.price.toFixed(2)}</div>
                <button onclick="deleteProduct('${product.id}')" class="btn-secondary" style="background: #EF4444; margin-top: 0.5rem;">
                    Delete
                </button>
            </div>
        </div>
    `).join('');
}

// Delete product
window.deleteProduct = async function(productId) {
    if (confirm('Are you sure you want to delete this product?')) {
        const response = await fetch(`${API_URL}/api/products/${productId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if (response.ok) {
            alert('Product deleted successfully');
            loadMyProducts();
        }
    }
};

// Search products
function searchProducts() {
    const searchTerm = document.getElementById('searchInput').value;
    loadProducts('all', searchTerm);
    showView('products');
}

// Login
async function login(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    if (data.token) {
        localStorage.setItem('token', data.token);
        currentUser = data.user;
        showUserMenu();
        document.getElementById('loginModal').style.display = 'none';
        connectSocket();
        loadUserChats();
        loadProducts();
    } else {
        alert(data.error || 'Login failed');
    }
}

// Register
async function register(e) {
    e.preventDefault();
    
    const fullName = document.getElementById('regFullName').value;
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    
    const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, username, email, password })
    });
    
    const data = await response.json();
    if (data.token) {
        localStorage.setItem('token', data.token);
        currentUser = data.user;
        showUserMenu();
        document.getElementById('registerModal').style.display = 'none';
        connectSocket();
        loadProducts();
    } else {
        alert(data.error || 'Registration failed');
    }
}

// Logout
function logout() {
    localStorage.removeItem('token');
    currentUser = null;
    if (currentSocket) {
        currentSocket.disconnect();
    }
    document.getElementById('authLinks').style.display = 'flex';
    document.getElementById('userMenu').style.display = 'none';
    showView('products');
    loadProducts();
}

// Show modals
function showLoginModal() {
    document.getElementById('loginModal').style.display = 'block';
}

function showRegisterModal() {
    document.getElementById('registerModal').style.display = 'block';
}

// Show notification
function showNotification(message) {
    if (Notification.permission === 'granted') {
        new Notification('MarketHub', { body: message });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
