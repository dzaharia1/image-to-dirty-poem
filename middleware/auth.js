import { getAuth } from 'firebase-admin/auth';
import { db } from '../config/firebase.js';

// In-memory allowlist cache
let allowedUserIds = new Set();

// Subscribe to allowlist updates
if (db) {
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
}

export const authenticate = async (req, res, next) => {
  // Skip auth for root, favicon, /generate-poem (Arduino), and public endpoints (WebDisplay/Puppeteer)
  // Note: /generate-poem and /public/getPoem handle their own auth or are public.
  // However, in the original server.js, /generate-poem was excluded from the global auth middleware using this check.
  const publicPaths = ['/', '/favicon.ico', '/generate-poem', '/public/getPoem', '/public/getWebDisplayPoem'];
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
};

// Export the allowlist for use in other controllers if needed (e.g. generate-poem which has its own auth logic)
export { allowedUserIds };
