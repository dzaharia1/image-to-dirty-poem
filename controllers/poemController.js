import { db } from '../config/firebase.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { basicPrompt, dirtyLimerickPrompt, haikuPrompt } from '../systemPrompts.js';
import { formatDate } from '../utils/helpers.js';
import { allowedUserIds } from '../middleware/auth.js';

export const listPoems = async (req, res) => {
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
};

export const getPoem = async (req, res) => {
  try {
    const userId = req.user.uid; // Use verified UID from token
    let index = parseInt(req.query.index);
    if (isNaN(index) || index < 0) index = 0;

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
    console.error('Error fetching poem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getPublicPoem = async (req, res) => {
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
};

export const toggleFavorite = async (req, res) => {
  try {
    const { id, status } = req.body;
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
    if (status !== undefined) {
      newStatus = status === true || status === 'true';
    } else {
      newStatus = !poemData.isFavorite;
    }

    await poemRef.update({ isFavorite: newStatus });

    res.json({ success: true, isFavorite: newStatus });

  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deletePoem = async (req, res) => {
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
};

export const generatePoem = async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Received request to /generate-poem`);
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
    // Note: This requires the correct middleware setup to populate req.user on this endpoint if a token is present,
    // OR we need to manually verify inside here if we want to skip global middleware for this specific route.
    // In server.js, /generate-poem was excluded from global middleware.
    // So req.user might be undefined unless we run specific auth middleware here or manually parse.
    
    // Since we are refactoring, we'll assume we can use a flexible auth middleware or handle it manually here.
    // For now, let's assume req.user is populated if token is present, 
    // BUT since we are excluding it from global auth in `middleware/auth.js`, we need to handle token verification here if we want to support it.
    
    // Actually, the previous implementation had global auth middleware attempting to verify token, but skipping for /generate-poem.
    // Meaning /generate-poem auth logic IS mostly manual or reliant on query param if global skipped it?
    // Wait, lines 60-64 in original server.js:
    // app.use(async (req, res, next) => {
    //   if (publicPaths.includes(req.path)) { return next(); } ...
    // So yes, global auth was SKIPPED for /generate-poem.
    // So req.user would be undefined unless we do something else.
    // BUT, lines 584: if (req.user && req.user.uid) ...
    // This implies that EITHER the global middleware actually RAN (contradicting lines 60-64) OR there is some other mechanism.
    // Looking closely at lines 60-64:
    // const publicPaths = ['/', '/favicon.ico', '/generate-poem', '/public/getPoem'];
    // ... return next();
    // It returns next() immediately, so req.user is NOT populated by that middleware.
    // So line 584 `if (req.user && req.user.uid)` in original `server.js` would likely always be false unless another middleware ran?
    // Ah, wait. `app.use` runs in order. If `generate-poem` is hit, it skips auth.
    // So logic at 584 seems dead code in the original server.js UNLESS I missed something.
    // OR, maybe the user wants to support token auth for generate-poem now?
    // "Dual Authentication: Try token first (web), fallback to userid (Arduino)"
    // If I want to support this, I should probably try to verify token here if header exists.
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
       // We can try to import getAuth and verify
       try {
         const { getAuth } = await import('firebase-admin/auth');
         const idToken = authHeader.split('Bearer ')[1];
         const decodedToken = await getAuth().verifyIdToken(idToken);
         userId = decodedToken.uid;
         console.log(`Using verified UID from token: ${userId}`);
       } catch (e) {
         console.warn("Token verification failed in generatePoem:", e);
       }
    }

    if (!userId && req.query.userid) {
      userId = req.query.userid;
      console.log(`Using userid parameter (Arduino): ${userId}`);
      
      if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
        console.log(`Blocked access attempt from unauthorized user: ${userId}`);
        return res.status(403).json({ error: 'Access denied: User not on allowlist' });
      }
    }

    if (!userId) {
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
    let jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse JSON from Gemini:', text);
      try {
        const fixedJson = jsonString
          .replace(/\n(?=([^"]*"[^"]*")*[^"]*$)/g, ' ') 
          .replace(/\n/g, '\\n') 
          .replace(/\r/g, '\\r');
        data = JSON.parse(fixedJson);
        console.log('Successfully parsed JSON after literal newline fix');
      } catch (secondError) {
        return res.status(500).json({ error: 'Failed to generate valid JSON' });
      }
    }

    const { dayOfWeek, date, month, year } = formatDate(userTimezone);

    const enrichedData = {
      ...data,
      dayOfWeek,
      date,
      month,
      year
    };

    res.json(enrichedData);

    try {
      await db.collection('poems').add({
        ...enrichedData,
        userId: userId,
        timestamp: new Date(),
        isFavorite: false,
        penName: penName || '' 
      });
      console.log('Poem saved to Firestore for user:', userId);
    } catch (dbError) {
      console.error('Error saving to Firestore:', dbError);
    }

  } catch (error) {
    console.error('Error generating poem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
