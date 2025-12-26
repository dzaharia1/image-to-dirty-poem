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

    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is missing');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const base64Image = imageBuffer.toString('base64');


    let prompt = dirtyLimerickPrompt;
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

    res.json(data);

    // Save to Firestore
    try {
      const userId = req.query.userid || 'anonymous';
      await db.collection('poems').add({
        ...data,
        userId: userId,
        timestamp: new Date()
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

