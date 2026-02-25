import { db } from '../config/firebase.js';

export const getSettings = async (req, res) => {
  try {
    const userid = req.user.uid; // Use verified UID from token

    const allowlistRef = db.collection('allowlist');
    const snapshot = await allowlistRef.where('uid', '==', userid).limit(1).get();

    if (snapshot.empty) {
      // If user not in allowlist, they shouldn't even be here normally due to auth middleware,
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
};

export const updateSettings = async (req, res) => {
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
};

export const usesWebDisplay = (req, res) => {
  const uid = req.user.uid;
  res.json({ usesWebDisplay: uid === process.env.WEB_DISPLAY_USER });
};

export const setWebDisplayPoem = async (req, res) => {
  try {
    const userid = req.user.uid;
    const { poemId } = req.body;

    const allowlistRef = db.collection('allowlist');
    const snapshot = await allowlistRef.where('uid', '==', userid).limit(1).get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'User not found in allowlist' });
    }

    await snapshot.docs[0].ref.update({ webDisplayPoem: poemId || null });

    res.json({ success: true });
  } catch (error) {
    console.error('Error setting web display poem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
