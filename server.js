import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';
import { basicPrompt, dirtyLimerickPrompt, haikuPrompt } from './systemPrompts.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3109;

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://apis.google.com",
        "https://www.googleapis.com",
        "https://static.cloudflareinsights.com"
      ],
    },
  },
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all requests
app.use(limiter);

app.use(cors());

// Disable Cloudflare's automatic script injection
app.use((req, res, next) => {
  res.setHeader('cf-edge-cache', 'no-transform');
  next();
});

// Enable JSON body parsing for POST requests (Must be before auth middleware)
app.use(express.json());

// In-memory allowlist cache
let allowedUserIds = new Set();

// Firebase Token Authentication Middleware
app.use(async (req, res, next) => {
  // Skip auth for root, favicon, /generate-poem (Arduino), and public endpoints (WebDisplay/Puppeteer)
  const publicPaths = ['/', '/favicon.ico', '/generate-poem', '/public/getPoem'];
  if (publicPaths.includes(req.path)) {
    return next();
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required: Missing or invalid token' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify the token with Firebase Admin
    const decodedToken = await getAuth().verifyIdToken(idToken);
    
    // Extract verified UID and attach to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email
    };

    // Verify user is on allowlist
    if (allowedUserIds.size > 0 && !allowedUserIds.has(req.user.uid)) {
      console.log(`Blocked access attempt from unauthorized user: ${req.user.uid}`);
      return res.status(403).json({ error: 'Access denied: User not on allowlist' });
    }

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    
    return res.status(401).json({ error: 'Invalid authentication token' });
  }
});

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-flash-latest",
  generationConfig: { responseMimeType: "application/json" }
});

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('Firebase Admin initialized');
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
  }
} else {
  console.warn('FIREBASE_SERVICE_ACCOUNT_KEY not found in .env');
}

const db = getFirestore();

// Subscribe to allowlist updates
db.collection('allowlist').onSnapshot(snapshot => {
  const newAllowlist = new Set();
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.uid) {
      newAllowlist.add(data.uid);
    }
  });
  allowedUserIds = newAllowlist;
  console.log(`Updated allowlist: ${allowedUserIds.size} users`);
}, error => {
  console.error("Error listening to allowlist:", error);
});



app.get('/', (req, res) => {
  res.send('Poetry Cam Backend');
});



app.get('/generate-poem', (req, res) => {
  res.send('This endpoint requires a POST request with an image file. To test in the browser, use a tool like Postman or the Poetry Cam hardware.');
});

// fetch a list of 50 poems, including each poem's title, index, timestamp and colors, accepts userid as a query parameter and an optional parameter of "page" to fetch a different set of poems
app.get('/poemList', async (req, res) => {
  try {
    const userId = req.user.uid; // Use verified UID from token
    let page = parseInt(req.query.page);
    if (isNaN(page) || page < 1) page = 1;

    const limit = 50;
    const offset = (page - 1) * limit;

    const poemsRef = db.collection('poems');
    let query = poemsRef.where('userId', '==', userId);

    if (req.query.sortByDate === 'true') {
      query = query.orderBy('timestamp', 'desc');
    } else {
      query = query.orderBy('isFavorite', 'desc').orderBy('timestamp', 'desc');
    }

    const snapshot = await query
      .offset(offset)
      .limit(limit)
      .get();

    const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(docs);
  } catch (error) {
    console.error('DETAILED FIRESTORE ERROR:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/getPoem', async (req, res) => {
  try {
    const userId = req.user.uid; // Use verified UID from token
    let index = parseInt(req.query.index);
    if (isNaN(index) || index < 0) index = 0;

    const poemsRef = db.collection('poems');

    // Calculate offset and limit to fetch current, previous, and next poems
    // If index is 0 (latest), we need index 0 (current) and index 1 (previous/older)
    // If index > 0, we need index-1 (next/newer), index (current), and index+1 (previous/older)

    let offset = Math.max(0, index - 1);
    let limitVal = (index === 0) ? 2 : 3;

    let baseQuery = poemsRef.where('userId', '==', userId);

    if (req.query.favoritesOnly === 'true') {
      baseQuery = baseQuery.where('isFavorite', '==', true);
    }

    if (req.query.sortByDate === 'true') {
      // If we are sorting by date, we ignore the isFavorite field
      baseQuery = baseQuery.orderBy('timestamp', 'desc');
    } else {
      // Default behavior: Favorites first, then date
      baseQuery = baseQuery
        .orderBy('isFavorite', 'desc')
        .orderBy('timestamp', 'desc');
    }

    const snapshot = await baseQuery
      .offset(offset)
      .limit(limitVal)
      .get();

    if (snapshot.empty) {
      return res.json({ currentPoem: null, nextPoem: null, previousPoem: null });
    }

    const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let currentPoem = null;
    let nextPoem = null; // Newer
    let previousPoem = null; // Older

    if (index === 0) {
      // We fetched [index, index+1] -> [0, 1]
      currentPoem = docs[0] ? { ...docs[0], index: 0 } : null;
      previousPoem = docs[1] ? { ...docs[1], index: 1 } : null;
      nextPoem = null; // No newer poem than the latest
    } else {
      // We fetched [index-1, index, index+1]
      nextPoem = docs[0] ? { ...docs[0], index: index - 1 } : null;
      currentPoem = docs[1] ? { ...docs[1], index: index } : null;
      previousPoem = docs[2] ? { ...docs[2], index: index + 1 } : null;
    }

    res.json({ currentPoem, nextPoem, previousPoem });

  } catch (error) {
    console.error('Error fetching poem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public endpoint for WebDisplay/Puppeteer (read-only, no auth required)
app.get('/public/getPoem', async (req, res) => {
  try {
    const userId = req.query.userid; // Accept userid from query param
    let index = parseInt(req.query.index);
    if (isNaN(index) || index < 0) index = 0;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userid parameter' });
    }

    const poemsRef = db.collection('poems');
    let offset = Math.max(0, index - 1);
    let limitVal = (index === 0) ? 2 : 3;

    let baseQuery = poemsRef.where('userId', '==', userId);

    if (req.query.favoritesOnly === 'true') {
      baseQuery = baseQuery.where('isFavorite', '==', true);
    }

    if (req.query.sortByDate === 'true') {
      baseQuery = baseQuery.orderBy('timestamp', 'desc');
    } else {
      baseQuery = baseQuery
        .orderBy('isFavorite', 'desc')
        .orderBy('timestamp', 'desc');
    }

    const snapshot = await baseQuery
      .offset(offset)
      .limit(limitVal)
      .get();

    if (snapshot.empty) {
      return res.json({ currentPoem: null, nextPoem: null, previousPoem: null });
    }

    const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let currentPoem = null;
    let nextPoem = null;
    let previousPoem = null;

    if (index === 0) {
      currentPoem = docs[0] ? { ...docs[0], index: 0 } : null;
      previousPoem = docs[1] ? { ...docs[1], index: 1 } : null;
      nextPoem = null;
    } else {
      nextPoem = docs[0] ? { ...docs[0], index: index - 1 } : null;
      currentPoem = docs[1] ? { ...docs[1], index: index } : null;
      previousPoem = docs[2] ? { ...docs[2], index: index + 1 } : null;
    }

    res.json({ currentPoem, nextPoem, previousPoem });

  } catch (error) {
    console.error('Error fetching poem (public):', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/toggleFavorite', async (req, res) => {
  try {
    const { id, status } = req.body; // Expect JSON body
    const userid = req.user.uid; // Use verified UID from token

    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const poemRef = db.collection('poems').doc(id);
    const doc = await poemRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Poem not found' });
    }

    const poemData = doc.data();
    if (poemData.userId !== userid) {
      return res.status(403).json({ error: 'Unauthorized to modify this poem' });
    }

    let newStatus;
    // explicit status check (boolean or string 'true'/'false')
    if (status !== undefined) {
      // Convert string "true"/"false" if sent that way, though body parsing usually handles boolean if JSON
      newStatus = status === true || status === 'true';
    } else {
      // Toggle if no status provided
      newStatus = !poemData.isFavorite;
    }

    await poemRef.update({ isFavorite: newStatus });

    res.json({ success: true, isFavorite: newStatus });

  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/deletePoem', async (req, res) => {
  try {
    const { id } = req.query;
    const userid = req.user.uid; // Use verified UID from token
    if (!id) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const poemRef = db.collection('poems').doc(id);
    const doc = await poemRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Poem not found' });
    }

    if (doc.data().userId !== userid) {
      return res.status(403).json({ error: 'Unauthorized to delete this poem' });
    }

    await poemRef.delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting poem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user settings
app.get('/get-settings', async (req, res) => {
  try {
    const userid = req.user.uid; // Use verified UID from token

    const allowlistRef = db.collection('allowlist');
    const snapshot = await allowlistRef.where('uid', '==', userid).limit(1).get();

    if (snapshot.empty) {
      // If user not in allowlist, they shouldn't even be here normally, 
      // but maybe return empty settings or 404? 
      // For now, return empty object so frontend can default.
      return res.json({});
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    // EXCLUDE geminiApiKey from response for security
    const { geminiApiKey, ...safeSettings } = data;

    // Return flag indicating if key is set
    const responseData = {
      ...safeSettings,
      hasGeminiApiKey: !!geminiApiKey && geminiApiKey.length > 0
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user settings
app.post('/update-settings', async (req, res) => {
  try {
    const { settings } = req.body;
    const userid = req.user.uid; // Use verified UID from token

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings' });
    }

    const allowlistRef = db.collection('allowlist');
    const snapshot = await allowlistRef.where('uid', '==', userid).limit(1).get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'User not found in allowlist' });
    }

    const doc = snapshot.docs[0];

    // We only update fields that are allowed to be updated
    const updates = {};
    if (settings.geminiApiKey !== undefined) updates.geminiApiKey = settings.geminiApiKey;
    if (settings.timezone !== undefined) updates.timezone = settings.timezone;
    if (settings.themeMode !== undefined) updates.themeMode = settings.themeMode;
    if (settings.penName !== undefined) updates.penName = settings.penName;

    await doc.ref.update(updates);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Get all users (whitelisted and others)
app.get('/admin/users', async (req, res) => {
  try {
    const userid = req.user.uid; // Use verified UID from token
    const ADMIN_UID = process.env.ADMIN_UID;

    if (userid !== ADMIN_UID) {
      return res.status(403).json({ error: 'Access denied: Unauthorized' });
    }

    // 1. Get all allowed users from Firestore
    const allowlistRef = db.collection('allowlist');
    const allowlistSnapshot = await allowlistRef.get();
    const allowedUsers = allowlistSnapshot.docs.map(doc => doc.data());
    const allowedUids = new Set(allowedUsers.map(u => u.uid));

    // 2. Get all users from Firebase Auth
    // Note: listUsers() retrieves a batch of users (defaults to 1000). 
    // For a large user base, we'd need pagination, but this should suffice for now.
    const auth = getAuth();
    const listUsersResult = await auth.listUsers(1000);
    const allAuthUsers = listUsersResult.users.map(userRecord => ({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      metadata: userRecord.metadata,
    }));

    // 3. Separate into "Allowed" (enriched with auth data if available) and "Others"
    const allowedList = [];
    const otherList = [];

    // Map allowed UIDs to their auth data if it exists
    allowedUsers.forEach(allowedUser => {
      const authUser = allAuthUsers.find(u => u.uid === allowedUser.uid);
      allowedList.push({
        ...allowedUser,
        email: authUser ? authUser.email : null,
        displayName: authUser ? authUser.displayName : null,
        lastSignInTime: authUser ? authUser.metadata.lastSignInTime : null,
        creationTime: authUser ? authUser.metadata.creationTime : null,
      });
    });

    // Find users in Auth but NOT in Allowlist
    allAuthUsers.forEach(authUser => {
      if (!allowedUids.has(authUser.uid)) {
        otherList.push({
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName,
          lastSignInTime: authUser.metadata.lastSignInTime,
          creationTime: authUser.metadata.creationTime,
        });
      }
    });

    res.json({ allowed: allowedList, others: otherList });

  } catch (error) {
    console.error('Error fetching admin user lists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Add user to whitelist
app.post('/admin/add-user', async (req, res) => {
  try {
    const { newUid } = req.body;
    const userid = req.user.uid; // Use verified UID from token
    const ADMIN_UID = process.env.ADMIN_UID;

    if (userid !== ADMIN_UID) {
      return res.status(403).json({ error: 'Access denied: Unauthorized' });
    }

    if (!newUid) {
      return res.status(400).json({ error: 'Missing newUid' });
    }

    // Check if already exists
    const allowlistRef = db.collection('allowlist');
    const snapshot = await allowlistRef.where('uid', '==', newUid).limit(1).get();

    if (!snapshot.empty) {
      return res.status(400).json({ error: 'User already in whitelist' });
    }

    // Add to allowlist
    await allowlistRef.add({
      uid: newUid,
      addedAt: new Date(),
      addedBy: userid
    });

    res.json({ success: true, uid: newUid });

  } catch (error) {
    console.error('Error adding user to whitelist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/generate-poem', (req, res, next) => {
  console.log(`[${new Date().toISOString()}] Received request to /generate-poem`);

  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('image/jpeg')) {
    express.raw({ type: 'image/jpeg', limit: '10mb' })(req, res, next);
  } else {
    upload.single('image')(req, res, next);
  }
}, async (req, res) => {
  try {
    let imageBuffer;
    let mimeType;

    if (req.file) {
      imageBuffer = req.file.buffer;
      mimeType = req.file.mimetype;
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      imageBuffer = req.body;
      mimeType = 'image/jpeg';
    }

    if (!imageBuffer) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Dual Authentication: Try token first (web), fallback to userid (Arduino)
    let userId = null;
    
    // Try to get UID from verified token first (web clients)
    if (req.user && req.user.uid) {
      userId = req.user.uid;
      console.log(`Using verified UID from token: ${userId}`);
    } else if (req.query.userid) {
      // Fallback to userid parameter (Arduino compatibility)
      userId = req.query.userid;
      console.log(`Using userid parameter (Arduino): ${userId}`);
      
      // Verify userid is on allowlist (same check as old middleware)
      if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        console.log(`Blocked access attempt from unauthorized user: ${userId}`);
        return res.status(403).json({ error: 'Access denied: User not on allowlist' });
      }
    } else {
      return res.status(401).json({ error: 'Authentication required: Missing token or userid' });
    }

    // Determine which API Key to use and get timezone and pen name
    let apiKey = null;
    let userTimezone = null;
    let penName = null;

    if (userId) {
      try {
        const allowlistRef = db.collection('allowlist');
        const snapshot = await allowlistRef.where('uid', '==', userId).limit(1).get();

        if (!snapshot.empty) {
          const userData = snapshot.docs[0].data();
          if (userData.geminiApiKey) {
            apiKey = userData.geminiApiKey;
            console.log(`Using custom API key for user: ${userId}`);
          }
          if (userData.timezone) {
            userTimezone = userData.timezone;
          }
          if (userData.penName) {
            penName = userData.penName;
          }
        }
      } catch (keyError) {
        console.error('Error fetching user settings:', keyError);
      }
    }

    if (!apiKey) {
      console.error('No API Key found for user:', userId);
      return res.status(400).json({
        error: 'Gemini API Key is missing. Please configure it in your settings.'
      });
    }

    // Initialize Gemini with the selected key and enable JSON mode
    const userGenAI = new GoogleGenerativeAI(apiKey);
    const userModel = userGenAI.getGenerativeModel({
      model: "gemini-flash-latest",
      generationConfig: { responseMimeType: "application/json" }
    });

    const base64Image = imageBuffer.toString('base64');


    let prompt = basicPrompt;
    if (req.query.type === 'dirty-limerick') {
      prompt = dirtyLimerickPrompt;
    } else if (req.query.type === 'dirty-haiku') {
      prompt = haikuPrompt;
    }
    const result = await userModel.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // Clean up the response to ensure it's valid JSON
    // Sometimes Gemini might wrap the JSON in markdown code blocks even in JSON mode
    let jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse JSON from Gemini:', text);
      // Fallback: try to fix literal newlines if they are the cause
      try {
        const fixedJson = jsonString
          .replace(/\n(?=([^"]*"[^"]*")*[^"]*$)/g, ' ') // Replace newlines NOT inside quotes with space
          .replace(/\n/g, '\\n') // Replace remaining newlines (inside quotes) with \n
          .replace(/\r/g, '\\r');
        data = JSON.parse(fixedJson);
        console.log('Successfully parsed JSON after literal newline fix');
      } catch (secondError) {
        return res.status(500).json({ error: 'Failed to generate valid JSON' });
      }
    }

    // Add timestamp fields
    const now = new Date();
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    let dayOfWeek = daysOfWeek[now.getDay()];
    let dateNum = now.getDate();
    let month = months[now.getMonth()];
    let yearNum = now.getFullYear();

    if (userTimezone) {
      try {
        const options = {
          timeZone: userTimezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(now);
        const getPart = (type) => parts.find(p => p.type === type).value;

        dayOfWeek = getPart('weekday');
        dateNum = parseInt(getPart('day'), 10);
        month = getPart('month');
        yearNum = parseInt(getPart('year'), 10);
      } catch (e) {
        console.error(`Invalid timezone '${userTimezone}', falling back to server time.`);
      }
    }

    const enrichedData = {
      ...data,
      dayOfWeek,
      date: dateNum,
      month,
      year: yearNum
    };

    res.json(enrichedData);

    // Save to Firestore
    try {
      const saveUserId = req.query.userid;
      await db.collection('poems').add({
        ...enrichedData,
        userId: saveUserId,
        timestamp: now,
        isFavorite: false,
        penName: penName || '' // Include pen name in poem document
      });
      console.log('Poem saved to Firestore for user:', saveUserId);
    } catch (dbError) {
      console.error('Error saving to Firestore:', dbError);
    }

  } catch (error) {
    console.error('Error generating poem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});

