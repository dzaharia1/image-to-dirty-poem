import { db } from '../config/firebase.js';
import { getAuth } from 'firebase-admin/auth';

export const getUsers = async (req, res) => {
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
};

export const addUser = async (req, res) => {
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
};
