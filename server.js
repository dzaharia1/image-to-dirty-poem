import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import { basicPrompt, dirtyLimerickPrompt, haikuPrompt } from './systemPrompts.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = 3109;

app.use(cors());

// Disable Cloudflare's automatic script injection
app.use((req, res, next) => {
  res.setHeader('cf-edge-cache', 'no-transform');
  next();
});

app.use(express.json()); // Enable JSON body parsing for POST requests

// In-memory allowlist cache
let allowedUserIds = new Set();

// Initialize Firestore (this happens later in the file, but we need the db reference)
// Moving the db initialization up or wrapping the listener in a function that runs after db init is safer.
// However, seeing line 56 `const db = getFirestore();`... let's reorganize slightly to be safe, 
// OR just put the listener after db init and the middleware can stay here but check the Set.
// The middleware:
app.use((req, res, next) => {
  const userId = req.query.userid || req.body.userid;
  // If the allowlist is empty (e.g. startup), we might want to fail open or closed? 
  // For safety, fail closed, but maybe log a warning if it's size 0.
  // Actually, if userId is provided, we check. 
  if (userId && !allowedUserIds.has(userId)) {
     console.log(`Blocked access attempt from unauthorized user: ${userId}`);
     return res.status(403).json({ error: 'Access denied: User not on allowlist' });
  }
  next();
});

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Serve static files from the 'image' directory
app.use('/image', express.static(path.join(__dirname, 'image')));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

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

let lastData;

app.get('/', (req, res) => {
  res.send('Poetry Cam Backend');
});

app.get('/last-data', (req, res) => {
  console.log(`request to last data`);
  console.log(lastData);
  res.json(lastData || {});
});

app.get('/generate-poem', (req, res) => {
  res.send('This endpoint requires a POST request with an image file. To test in the browser, use a tool like Postman or the Poetry Cam hardware.');
});

// Migration endpoint to fix existing poems
app.get('/migrate-poems', async (req, res) => {
  try {
    const userId = req.query.userid;
    console.log(`Starting migration for userId: ${userId || 'ALL USERS'}`);
    
    let query = db.collection('poems');
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    
    const snapshot = await query.get();
    console.log(`Found ${snapshot.size} poems to check`);
    
    const batch = db.batch();
    let updateCount = 0;
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.isFavorite === undefined) {
        batch.update(doc.ref, { isFavorite: false });
        updateCount++;
      }
    });
    
    if (updateCount > 0) {
      await batch.commit();
    }
    
    res.json({ 
      success: true, 
      checked: snapshot.size, 
      updated: updateCount,
      message: `Updated ${updateCount} poems. Refresh your app now.` 
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// fetch a list of 50 poems, including each poem's title, index, timestamp and colors, accepts userid as a query parameter and an optional parameter of "page" to fetch a different set of poems
app.get('/poemList', async (req, res) => {
  try {
    const userId = req.query.userid;
    const page = parseInt(req.query.page) || 1;
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
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get('/getPoem', async (req, res) => {
  try {
    const userId = req.query.userid;
    const index = parseInt(req.query.index) || 0;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userid parameter' });
    }

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

app.post('/toggleFavorite', async (req, res) => {
  try {
    const { id, userid, status } = req.body; // Expect JSON body

    if (!id || !userid) {
      return res.status(400).json({ error: 'Missing id or userid' });
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
    const { id, userid } = req.query;
    if (!id || !userid) {
      return res.status(400).json({ error: 'Missing id or userid' });
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
    const { userid } = req.query;
    if (!userid) {
      return res.status(400).json({ error: 'Missing userid' });
    }

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
    const { userid, settings } = req.body;
    
    if (!userid || !settings) {
      return res.status(400).json({ error: 'Missing userid or settings' });
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

    // Save the image to filesystem
    try {
      const imageDir = path.join(__dirname, 'image');
      if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
      }
      const imagePath = path.join(imageDir, 'image.png');
      fs.writeFileSync(imagePath, imageBuffer);
      console.log('Image saved to:', imagePath);
    } catch (saveError) {
      console.error('Error saving image to filesystem:', saveError);
    }

    // Determine which API Key to use and get timezone
    let apiKey = null;
    let userTimezone = null;
    const userId = req.query.userid;

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

    // Initialize Gemini with the selected key
    const userGenAI = new GoogleGenerativeAI(apiKey);
    const userModel = userGenAI.getGenerativeModel({ model: "gemini-flash-latest" });

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
    // Sometimes Gemini might wrap the JSON in markdown code blocks
    let jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let data;
    try {
      data = JSON.parse(jsonString);
      lastData = data;
    } catch (parseError) {
      console.error('Failed to parse JSON from Gemini:', text);
      return res.status(500).json({ error: 'Failed to generate valid JSON', raw: text });
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
      const saveUserId = req.query.userid || 'anonymous';
      await db.collection('poems').add({
        ...enrichedData,
        userId: saveUserId,
        timestamp: now,
        isFavorite: false
      });
      console.log('Poem saved to Firestore for user:', saveUserId);
    } catch (dbError) {
      console.error('Error saving to Firestore:', dbError);
    }

  } catch (error) {
    console.error('Error generating poem:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});

