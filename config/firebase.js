import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Initialize Firebase Admin
if (!getApps().length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      // If serviceAccount is a path, we might need to resolve it, but the original code treated it as content or path handled by cert?
      // Original code: cert(serviceAccount)
      // verify if serviceAccount is a string path or object. 
      // The original code uses process.env.FIREBASE_SERVICE_ACCOUNT_KEY directly.
      
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log('Firebase Admin initialized');
    } catch (error) {
      console.error('Error initializing Firebase Admin:', error);
    }
  } else {
    // Check if we are in dev and maybe use a local file if env var is missing?
    // For now, mirroring original logic with a warning.
    console.warn('FIREBASE_SERVICE_ACCOUNT_KEY not found in .env');
  }
}

export const db = getFirestore();
export const auth = getAuth();
