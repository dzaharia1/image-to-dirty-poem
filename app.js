import express from 'express';
import dotenv from 'dotenv';
import path from 'path';

// Config & Middleware
import './config/firebase.js'; // Initialize Firebase
import { configureSecurity } from './middleware/security.js';
import { authenticate } from './middleware/auth.js';

// Routes
import poemRoutes from './routes/poems.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const app = express();

// 1. Security Middleware (Helmet, CORS, RateLimit)
configureSecurity(app);

// 2. Body Parsing (JSON)
app.use(express.json());

// 3. Authentication Middleware
// Note: It skips public paths internally, but we can also mount it specifically if desired.
// The internal check in middleware/auth.js handles the exclusion list.
app.use(authenticate);

// 4. Routes
app.get('/', (req, res) => {
  res.send('Poetry Cam Backend');
});

// Mount routes
// Note: adminRoutes are mounted at /admin
app.use('/admin', adminRoutes);

// Config routes are mounted at root in original server.js (e.g. /get-settings)
app.use('/', userRoutes);

// Poem routes are mounted at root
app.use('/', poemRoutes);

// 5. Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
