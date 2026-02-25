import { jest } from '@jest/globals';
import request from 'supertest';

// Define Mocks
const mockCollection = jest.fn();
const mockDoc = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();
const mockOffset = jest.fn();
const mockGet = jest.fn();
const mockAdd = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockOnSnapshot = jest.fn();

const mockDb = {
  collection: mockCollection,
};

// Chainable mock setup
mockCollection.mockReturnValue({
  doc: mockDoc,
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
  offset: mockOffset,
  get: mockGet,
  add: mockAdd,
  onSnapshot: mockOnSnapshot,
});

mockDoc.mockReturnValue({
  get: mockGet,
  update: mockUpdate,
  delete: mockDelete,
  set: jest.fn(),
});

mockWhere.mockReturnValue({
  orderBy: mockOrderBy,
  limit: mockLimit,
  offset: mockOffset,
  get: mockGet,
  where: mockWhere, // chained where
});

mockOrderBy.mockReturnValue({
  limit: mockLimit,
  offset: mockOffset,
  get: mockGet,
  orderBy: mockOrderBy, // chained orderBy
});

mockLimit.mockReturnValue({
  offset: mockOffset,
  get: mockGet,
});

mockOffset.mockReturnValue({
  limit: mockLimit, // limit can come after offset? Typically offset then limit or vice versa.
  get: mockGet,
});

const mockGetAuth = jest.fn();
const mockVerifyIdToken = jest.fn();

// Mock Gemini
const mockGenerativeModel = {
  generateContent: jest.fn(),
};
const mockGetGenerativeModel = jest.fn(() => mockGenerativeModel);
const mockGoogleGenerativeAI = jest.fn(() => ({
  getGenerativeModel: mockGetGenerativeModel,
}));

// Setup mocks via unstable_mockModule BEFORE importing app
jest.unstable_mockModule('../../config/firebase.js', () => ({
  db: mockDb,
  storage: { bucket: jest.fn() }, // Simple mock for storage as it's not used in these tests directly but imported
}));

jest.unstable_mockModule('firebase-admin/auth', () => ({
  getAuth: mockGetAuth,
}));

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: mockGoogleGenerativeAI,
}));

// Import App
const { default: app } = await import('../../app.js');

describe('Poem Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Auth Mock
    mockGetAuth.mockReturnValue({
      verifyIdToken: mockVerifyIdToken,
    });

    // Default Auth Behavior
    mockVerifyIdToken.mockResolvedValue({ uid: 'testUser', email: 'test@example.com' });

    // Default Allowlist behavior (empty allowlist allows everyone)
    // mockOnSnapshot is called on import. We can't simulate callback easily here unless we capture it.
    // But empty allowlist is fine.
  });

  describe('GET /poemList', () => {
    test('should return list of poems for authenticated user', async () => {
      // Mock Firestore response
      const mockDocs = [
        { id: 'poem1', data: () => ({ title: 'Poem 1', userId: 'testUser' }) },
        { id: 'poem2', data: () => ({ title: 'Poem 2', userId: 'testUser' }) },
      ];

      mockGet.mockResolvedValue({
        docs: mockDocs,
        empty: false,
      });

      const res = await request(app)
        .get('/poemList?page=1')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].title).toBe('Poem 1');
    });

    test('should return 401 if token is missing', async () => {
      const res = await request(app).get('/poemList');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /getPoem', () => {
    test('should return poem details', async () => {
       const mockDocs = [
        { id: 'poem1', data: () => ({ title: 'Poem 1', userId: 'testUser', timestamp: 100 }) }, // Current
        { id: 'poem0', data: () => ({ title: 'Poem 0', userId: 'testUser', timestamp: 90 }) }, // Previous
      ];

      mockGet.mockResolvedValue({
        docs: mockDocs,
        empty: false,
      });

      const res = await request(app)
        .get('/getPoem?index=0')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('currentPoem');
      // Logic for index 0: docs[0] is current, docs[1] is previous
      expect(res.body.currentPoem.title).toBe('Poem 1');
      expect(res.body.previousPoem.title).toBe('Poem 0');
      expect(res.body.nextPoem).toBeNull();
    });
  });

  describe('DELETE /deletePoem', () => {
    test('should delete poem if owner', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ userId: 'testUser' }),
      });

      const res = await request(app)
        .delete('/deletePoem?id=poem1')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(200);
      expect(mockDelete).toHaveBeenCalled();
    });

    test('should return 403 if not owner', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ userId: 'otherUser' }),
      });

      const res = await request(app)
        .delete('/deletePoem?id=poem1')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(403);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('GET /public/getWebDisplayPoem', () => {
    test('should return the web display poem', async () => {
      mockGet
        .mockResolvedValueOnce({
          empty: false,
          docs: [{ data: () => ({ uid: 'testUser', webDisplayPoem: 'poem123' }) }],
        })
        .mockResolvedValueOnce({
          exists: true,
          id: 'poem123',
          data: () => ({ userId: 'testUser', title: 'My Poem', poem: 'Line 1' }),
        });

      const res = await request(app).get('/public/getWebDisplayPoem?userid=testUser');

      expect(res.status).toBe(200);
      expect(res.body.currentPoem.title).toBe('My Poem');
      expect(res.body.currentPoem.id).toBe('poem123');
    });

    test('should return 400 if userid is missing', async () => {
      const res = await request(app).get('/public/getWebDisplayPoem');
      expect(res.status).toBe(400);
    });

    test('should return null if user not in allowlist', async () => {
      mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

      const res = await request(app).get('/public/getWebDisplayPoem?userid=testUser');

      expect(res.status).toBe(200);
      expect(res.body.currentPoem).toBeNull();
    });

    test('should return null if no webDisplayPoem set', async () => {
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ data: () => ({ uid: 'testUser' }) }],
      });

      const res = await request(app).get('/public/getWebDisplayPoem?userid=testUser');

      expect(res.status).toBe(200);
      expect(res.body.currentPoem).toBeNull();
    });

    test('should return null if poem does not exist', async () => {
      mockGet
        .mockResolvedValueOnce({
          empty: false,
          docs: [{ data: () => ({ uid: 'testUser', webDisplayPoem: 'poem123' }) }],
        })
        .mockResolvedValueOnce({ exists: false });

      const res = await request(app).get('/public/getWebDisplayPoem?userid=testUser');

      expect(res.status).toBe(200);
      expect(res.body.currentPoem).toBeNull();
    });

    test('should return null if poem is owned by a different user', async () => {
      mockGet
        .mockResolvedValueOnce({
          empty: false,
          docs: [{ data: () => ({ uid: 'testUser', webDisplayPoem: 'poem123' }) }],
        })
        .mockResolvedValueOnce({
          exists: true,
          id: 'poem123',
          data: () => ({ userId: 'otherUser', title: 'Not Mine' }),
        });

      const res = await request(app).get('/public/getWebDisplayPoem?userid=testUser');

      expect(res.status).toBe(200);
      expect(res.body.currentPoem).toBeNull();
    });
  });

  describe('POST /generate-poem', () => {
    test('should generate poem successfully', async () => {
      // Mock Gemini Response
      const mockGeminiResponse = {
        response: {
          text: () => JSON.stringify({
            title: 'Generated Poem',
            poem: 'Line 1\nLine 2',
            palette: ['#000000']
          })
        }
      };

      // Use module-scope mockGenerativeModel
      mockGenerativeModel.generateContent.mockResolvedValue(mockGeminiResponse);

      // Mock User Settings (API Key)
      // The controller fetches user settings from 'allowlist' collection
      mockGet.mockResolvedValue({
        empty: false,
        docs: [{
          data: () => ({ geminiApiKey: 'fake-api-key', timezone: 'UTC' })
        }]
      });

      const res = await request(app)
        .post('/generate-poem')
        .set('Authorization', 'Bearer validtoken')
        .attach('image', Buffer.from('fakeimage'), 'test.jpg');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Generated Poem');
      expect(mockGenerativeModel.generateContent).toHaveBeenCalled();
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 300,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      }));
    });
  });
});
