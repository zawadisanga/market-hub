const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Database file paths
const DB_PATH = path.join(dataDir, 'database.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Initialize database
function initDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
      users: [],
      products: [],
      messages: [],
      chats: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

// Read database
function readDB() {
  const data = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(data);
}

// Write database
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

initDB();

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Routes

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;
    const db = readDB();

    // Check if user exists
    if (db.users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    if (db.users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: uuidv4(),
      username,
      email,
      password: hashedPassword,
      fullName,
      createdAt: new Date().toISOString(),
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=random`
    };

    db.users.push(newUser);
    writeDB(db);

    // Generate token
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, email: newUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        fullName: newUser.fullName,
        avatar: newUser.avatar
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = readDB();

    const user = db.users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user
app.get('/api/me', authenticateToken, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    avatar: user.avatar
  });
});

// Create product listing
app.post('/api/products', authenticateToken, upload.array('images', 5), (req, res) => {
  try {
    const { title, description, price, category, condition } = req.body;
    const db = readDB();

    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);

    const newProduct = {
      id: uuidv4(),
      sellerId: req.user.id,
      title,
      description,
      price: parseFloat(price),
      category,
      condition,
      images: imageUrls,
      createdAt: new Date().toISOString(),
      status: 'active'
    };

    db.products.push(newProduct);
    writeDB(db);

    res.json(newProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all products
app.get('/api/products', (req, res) => {
  const db = readDB();
  const { category, search } = req.query;
  
  let products = db.products.filter(p => p.status === 'active');
  
  if (category && category !== 'all') {
    products = products.filter(p => p.category === category);
  }
  
  if (search) {
    products = products.filter(p => 
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
    );
  }
  
  // Add seller info
  products = products.map(product => {
    const seller = db.users.find(u => u.id === product.sellerId);
    return {
      ...product,
      seller: seller ? {
        id: seller.id,
        username: seller.username,
        fullName: seller.fullName,
        avatar: seller.avatar
      } : null
    };
  });
  
  res.json(products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// Get single product
app.get('/api/products/:id', (req, res) => {
  const db = readDB();
  const product = db.products.find(p => p.id === req.params.id);
  
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  const seller = db.users.find(u => u.id === product.sellerId);
  res.json({
    ...product,
    seller: seller ? {
      id: seller.id,
      username: seller.username,
      fullName: seller.fullName,
      avatar: seller.avatar
    } : null
  });
});

// Get user's products
app.get('/api/my-products', authenticateToken, (req, res) => {
  const db = readDB();
  const products = db.products.filter(p => p.sellerId === req.user.id);
  res.json(products);
});

// Delete product
app.delete('/api/products/:id', authenticateToken, (req, res) => {
  const db = readDB();
  const productIndex = db.products.findIndex(p => p.id === req.params.id);
  
  if (productIndex === -1) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  if (db.products[productIndex].sellerId !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  db.products.splice(productIndex, 1);
  writeDB(db);
  
  res.json({ message: 'Product deleted successfully' });
});

// Get or create chat
app.post('/api/chats', authenticateToken, (req, res) => {
  const { productId, buyerId } = req.body;
  const db = readDB();
  
  const product = db.products.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  let chat = db.chats.find(c => 
    c.productId === productId && 
    ((c.buyerId === buyerId && c.sellerId === product.sellerId) ||
     (c.buyerId === product.sellerId && c.sellerId === buyerId))
  );
  
  if (!chat) {
    chat = {
      id: uuidv4(),
      productId,
      productTitle: product.title,
      sellerId: product.sellerId,
      buyerId: buyerId,
      createdAt: new Date().toISOString(),
      lastMessage: null
    };
    db.chats.push(chat);
    writeDB(db);
  }
  
  res.json(chat);
});

// Get user's chats
app.get('/api/chats', authenticateToken, (req, res) => {
  const db = readDB();
  const chats = db.chats.filter(c => 
    c.sellerId === req.user.id || c.buyerId === req.user.id
  );
  
  const chatsWithMessages = chats.map(chat => {
    const messages = db.messages.filter(m => m.chatId === chat.id);
    const otherUser = db.users.find(u => 
      u.id === (chat.sellerId === req.user.id ? chat.buyerId : chat.sellerId)
    );
    return {
      ...chat,
      messages: messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
      otherUser: otherUser ? {
        id: otherUser.id,
        username: otherUser.username,
        fullName: otherUser.fullName,
        avatar: otherUser.avatar
      } : null
    };
  });
  
  res.json(chatsWithMessages.sort((a, b) => 
    new Date(b.lastMessage?.timestamp || b.createdAt) - new Date(a.lastMessage?.timestamp || a.createdAt)
  ));
});

// Get chat messages
app.get('/api/chats/:chatId/messages', authenticateToken, (req, res) => {
  const db = readDB();
  const messages = db.messages.filter(m => m.chatId === req.params.chatId);
  res.json(messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
});

// Socket.IO for real-time chat
const connectedUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return next(new Error('Invalid token'));
    }
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.id}`);
  connectedUsers.set(socket.user.id, socket.id);
  
  // Join user's personal room
  socket.join(`user_${socket.user.id}`);
  
  // Send online status to all connected users
  io.emit('user_status', { userId: socket.user.id, status: 'online' });
  
  // Handle joining chat room
  socket.on('join_chat', (chatId) => {
    socket.join(`chat_${chatId}`);
    console.log(`User ${socket.user.id} joined chat ${chatId}`);
  });
  
  // Handle leaving chat room
  socket.on('leave_chat', (chatId) => {
    socket.leave(`chat_${chatId}`);
  });
  
  // Handle sending message
  socket.on('send_message', async (data) => {
    const { chatId, message, productId } = data;
    const db = readDB();
    
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat) {
      socket.emit('error', { message: 'Chat not found' });
      return;
    }
    
    // Verify user is part of chat
    if (chat.sellerId !== socket.user.id && chat.buyerId !== socket.user.id) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }
    
    const newMessage = {
      id: uuidv4(),
      chatId,
      senderId: socket.user.id,
      message,
      timestamp: new Date().toISOString(),
      read: false
    };
    
    db.messages.push(newMessage);
    
    // Update last message in chat
    chat.lastMessage = {
      message: message.substring(0, 50),
      timestamp: newMessage.timestamp,
      senderId: socket.user.id
    };
    
    writeDB(db);
    
    // Emit to chat room
    io.to(`chat_${chatId}`).emit('new_message', newMessage);
    
    // Notify other user
    const otherUserId = chat.sellerId === socket.user.id ? chat.buyerId : chat.sellerId;
    io.to(`user_${otherUserId}`).emit('message_notification', {
      chatId,
      message: newMessage,
      productTitle: chat.productTitle
    });
  });
  
  // Handle typing indicator
  socket.on('typing', (data) => {
    const { chatId, isTyping } = data;
    socket.to(`chat_${chatId}`).emit('user_typing', {
      userId: socket.user.id,
      isTyping
    });
  });
  
  // Handle mark as read
  socket.on('mark_read', (chatId) => {
    const db = readDB();
    const messages = db.messages.filter(m => 
      m.chatId === chatId && m.senderId !== socket.user.id && !m.read
    );
    
    messages.forEach(message => {
      message.read = true;
    });
    
    writeDB(db);
    io.to(`chat_${chatId}`).emit('messages_read', { chatId, userId: socket.user.id });
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.id}`);
    connectedUsers.delete(socket.user.id);
    io.emit('user_status', { userId: socket.user.id, status: 'offline' });
  });
});

// Serve static files
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}`);
});
