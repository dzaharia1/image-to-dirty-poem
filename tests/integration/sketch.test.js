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

// Mock Firestore
const mockDb = {
  collection: mockCollection,
};

// Chainable mock setup for Firestore
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
  where: mockWhere,
});

// Mock Storage
const mockSave = jest.fn();
const mockMakePublic = jest.fn();
const mockPublicUrl = jest.fn(() => 'https://storage.googleapis.com/bucket/sketches/poem1.png');

const mockFile = {
  save: mockSave,
  makePublic: mockMakePublic,
  publicUrl: mockPublicUrl,
};

const mockBucket = {
  file: jest.fn(() => mockFile),
};

const mockStorage = {
  bucket: jest.fn(() => mockBucket),
};

const mockGetAuth = jest.fn();
const mockVerifyIdToken = jest.fn();

// Mock Gemini
const mockGenerativeModel = {
  generateContent: jest.fn(),
};
const mockGoogleGenerativeAI = jest.fn(() => ({
  getGenerativeModel: jest.fn(() => mockGenerativeModel),
}));

// Setup mocks via unstable_mockModule BEFORE importing app
jest.unstable_mockModule('../../config/firebase.js', () => ({
  db: mockDb,
  storage: mockStorage,
  auth: { verifyIdToken: mockVerifyIdToken }
}));

jest.unstable_mockModule('firebase-admin/auth', () => ({
  getAuth: mockGetAuth,
}));

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: mockGoogleGenerativeAI,
}));

// Import App
const { default: app } = await import('../../app.js');

describe('POST /generate-sketch', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Auth Mock
    mockGetAuth.mockReturnValue({
      verifyIdToken: mockVerifyIdToken,
    });
    mockVerifyIdToken.mockResolvedValue({ uid: 'testUser', email: 'test@example.com' });
  });

  test('should generate sketch and update poem', async () => {
    mockCollection.mockImplementation((name) => {
      if (name === 'poems') {
        return {
          doc: () => ({
             get: jest.fn().mockResolvedValue({
               exists: true,
               data: () => ({ userId: 'testUser', title: 'Poem 1' })
             }),
             update: mockUpdate
          })
        };
      }
      if (name === 'allowlist') {
        return {
          where: () => ({
            limit: () => ({
              get: jest.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ geminiApiKey: 'fake-api-key' }) }]
              })
            })
          })
        };
      }
      return {};
    });

    const mockGeminiResponse = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'base64-image-data',
                    mimeType: 'image/png'
                  }
                }
              ]
            }
          }
        ]
      }
    };
    mockGenerativeModel.generateContent.mockResolvedValue(mockGeminiResponse);

    const res = await request(app)
      .post('/generate-sketch')
      .set('Authorization', 'Bearer validtoken')
      .send({
        id: 'poem1',
        title: 'Poem Title',
        poem: 'Poem content'
      });

    expect(res.status).toBe(200);
    expect(res.body.sketchUrl).toBe('https://storage.googleapis.com/bucket/sketches/poem1.png');

    // Verify Gemini called
    expect(mockGenerativeModel.generateContent).toHaveBeenCalledWith(
      expect.stringContaining('Title: Poem Title')
    );

    // Verify Storage called
    expect(mockBucket.file).toHaveBeenCalledWith('sketches/poem1.png');
    expect(mockSave).toHaveBeenCalled();
    expect(mockMakePublic).toHaveBeenCalled();

    // Verify Firestore updated
    expect(mockUpdate).toHaveBeenCalledWith({
      sketchUrl: 'https://storage.googleapis.com/bucket/sketches/poem1.png'
    });
  });

  test('should return 403 if user is not owner', async () => {
      mockCollection.mockImplementation((name) => {
      if (name === 'poems') {
        return {
          doc: () => ({
             get: jest.fn().mockResolvedValue({
               exists: true,
               data: () => ({ userId: 'otherUser' })
             })
          })
        };
      }
      return {};
    });

    const res = await request(app)
      .post('/generate-sketch')
      .set('Authorization', 'Bearer validtoken')
      .send({
        id: 'poem1',
        title: 'Poem Title',
        poem: 'Poem content'
      });

    expect(res.status).toBe(403);
  });

  test('should return 400 if parameters missing', async () => {
    const res = await request(app)
      .post('/generate-sketch')
      .set('Authorization', 'Bearer validtoken')
      .send({
        id: 'poem1'
        // Missing title and poem
      });
    expect(res.status).toBe(400);
  });

  test('should return 400 if API key missing', async () => {
     mockCollection.mockImplementation((name) => {
      if (name === 'poems') {
        return {
          doc: () => ({
             get: jest.fn().mockResolvedValue({
               exists: true,
               data: () => ({ userId: 'testUser' })
             })
          })
        };
      }
      if (name === 'allowlist') {
        return {
          where: () => ({
            limit: () => ({
              get: jest.fn().mockResolvedValue({
                empty: true, // No user settings found
              })
            })
          })
        };
      }
      return {};
    });

    const res = await request(app)
      .post('/generate-sketch')
      .set('Authorization', 'Bearer validtoken')
      .send({
        id: 'poem1',
        title: 'Poem Title',
        poem: 'Poem content'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/API Key is missing/);
  });
});
