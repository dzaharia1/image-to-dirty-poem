import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Initialize Firebase Admin
if (!getApps().length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      
      const config = {
        credential: cert(serviceAccount)
      };

      if (process.env.FIREBASE_STORAGE_BUCKET) {
        config.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
      }

      initializeApp(config);
      console.log('Firebase Admin initialized');
    } catch (error) {
      console.error('Error initializing Firebase Admin:', error);
    }
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT_KEY not found in .env');
  }
}

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
