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

    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is missing');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const base64Image = imageBuffer.toString('base64');


    let prompt = basicPrompt;
    if (req.query.type === 'dirty-limerick') {
      prompt = dirtyLimerickPrompt;
    } else if (req.query.type === 'dirty-haiku') {
      prompt = haikuPrompt;
    }
    const result = await model.generateContent([
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
    
    const enrichedData = {
      ...data,
      dayOfWeek: daysOfWeek[now.getDay()],
      date: now.getDate(),
      month: months[now.getMonth()],
      year: now.getFullYear()
    };

    res.json(enrichedData);

    // Save to Firestore
    try {
      const userId = req.query.userid || 'anonymous';
      await db.collection('poems').add({
        ...enrichedData,
        userId: userId,
        timestamp: now,
        isFavorite: false
      });
      console.log('Poem saved to Firestore for user:', userId);
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

