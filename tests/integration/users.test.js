import { jest } from '@jest/globals';
import request from 'supertest';

// Define Mocks
const mockCollection = jest.fn();
const mockDoc = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockOnSnapshot = jest.fn();

const mockDb = {
  collection: mockCollection,
};

// Chainable mock setup
mockCollection.mockReturnValue({
  doc: mockDoc,
  where: mockWhere,
  limit: mockLimit,
  get: mockGet,
  onSnapshot: mockOnSnapshot,
});

mockDoc.mockReturnValue({
  get: mockGet,
  update: mockUpdate,
  ref: { update: mockUpdate },
});

mockWhere.mockReturnValue({
  limit: mockLimit,
  get: mockGet,
});

mockLimit.mockReturnValue({
  get: mockGet,
});

const mockGetAuth = jest.fn();
const mockVerifyIdToken = jest.fn();

// Setup mocks via unstable_mockModule BEFORE importing app
jest.unstable_mockModule('../../config/firebase.js', () => ({
  db: mockDb,
}));

jest.unstable_mockModule('firebase-admin/auth', () => ({
  getAuth: mockGetAuth,
}));

// Import App
const { default: app } = await import('../../app.js');

describe('User Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Auth Mock
    mockGetAuth.mockReturnValue({
      verifyIdToken: mockVerifyIdToken,
    });

    // Default Auth Behavior
    mockVerifyIdToken.mockResolvedValue({ uid: 'testUser', email: 'test@example.com' });
  });

  describe('GET /get-settings', () => {
    test('should return user settings without API key', async () => {
      // Mock Firestore response
      mockGet.mockResolvedValue({
        empty: false,
        docs: [{
          data: () => ({ geminiApiKey: 'secret-key', timezone: 'UTC', themeMode: 'dark' })
        }],
      });

      const res = await request(app)
        .get('/get-settings')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(200);
      expect(res.body.timezone).toBe('UTC');
      expect(res.body.themeMode).toBe('dark');
      expect(res.body).not.toHaveProperty('geminiApiKey');
      expect(res.body.hasGeminiApiKey).toBe(true);
    });

    test('should return empty object if user not found', async () => {
      mockGet.mockResolvedValue({
        empty: true,
        docs: [],
      });

      const res = await request(app)
        .get('/get-settings')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });

  describe('POST /update-settings', () => {
    test('should update user settings', async () => {
      // Mock finding user
      mockGet.mockResolvedValue({
        empty: false,
        docs: [{
          id: 'docId',
          ref: { update: mockUpdate },
          data: () => ({ uid: 'testUser' })
        }],
      });

      const res = await request(app)
        .post('/update-settings')
        .set('Authorization', 'Bearer validtoken')
        .send({ settings: { timezone: 'PST', themeMode: 'light' } });

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ timezone: 'PST', themeMode: 'light' });
    });

    test('should return 404 if user not found in allowlist', async () => {
      mockGet.mockResolvedValue({
        empty: true,
        docs: [],
      });

      const res = await request(app)
        .post('/update-settings')
        .set('Authorization', 'Bearer validtoken')
        .send({ settings: { timezone: 'PST' } });

      expect(res.status).toBe(404);
    });

    test('should return 400 if settings invalid', async () => {
       const res = await request(app)
        .post('/update-settings')
        .set('Authorization', 'Bearer validtoken')
        .send({ settings: null }); // or missing settings

      expect(res.status).toBe(400);
    });
  });
});
