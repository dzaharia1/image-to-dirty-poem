import { jest } from '@jest/globals';
import request from 'supertest';

// Define Mocks
const mockCollection = jest.fn();
const mockGet = jest.fn();
const mockAdd = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockListUsers = jest.fn();
const mockOnSnapshot = jest.fn();

const mockDb = {
  collection: mockCollection,
};

// Chainable mock setup
mockCollection.mockReturnValue({
  get: mockGet,
  add: mockAdd,
  where: mockWhere,
  onSnapshot: mockOnSnapshot,
});

mockWhere.mockReturnValue({
  limit: mockLimit,
});

mockLimit.mockReturnValue({
  get: mockGet,
});

const mockGetAuth = jest.fn();
const mockVerifyIdToken = jest.fn();
const mockAuthInstance = {
  verifyIdToken: mockVerifyIdToken,
  listUsers: mockListUsers,
};

// Setup mocks via unstable_mockModule BEFORE importing app
jest.unstable_mockModule('../../config/firebase.js', () => ({
  db: mockDb,
  storage: { bucket: jest.fn() },
}));

jest.unstable_mockModule('firebase-admin/auth', () => ({
  getAuth: mockGetAuth,
}));

// Import App
const { default: app } = await import('../../app.js');

describe('Admin Routes Integration', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = { ...originalEnv, ADMIN_UID: 'adminUser' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Auth Mock
    mockGetAuth.mockReturnValue(mockAuthInstance);

    // Default Auth Behavior
    mockVerifyIdToken.mockResolvedValue({ uid: 'adminUser', email: 'admin@example.com' });
  });

  describe('GET /admin/users', () => {
    test('should return users list for admin', async () => {
      // Mock Firestore Allowlist
      mockGet.mockResolvedValue({
        docs: [
          { data: () => ({ uid: 'user1' }) },
          { data: () => ({ uid: 'user2' }) },
        ],
      });

      // Mock Auth List Users
      mockListUsers.mockResolvedValue({
        users: [
          { uid: 'user1', email: 'u1@example.com', metadata: {} },
          { uid: 'user2', email: 'u2@example.com', metadata: {} },
          { uid: 'user3', email: 'u3@example.com', metadata: {} }, // Not in allowlist
        ],
      });

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('allowed');
      expect(res.body).toHaveProperty('others');
      expect(res.body.allowed.length).toBe(2);
      expect(res.body.others.length).toBe(1);
    });

    test('should return 403 for non-admin user', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'regularUser' });

      const res = await request(app)
        .get('/admin/users')
        .set('Authorization', 'Bearer validtoken');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /admin/add-user', () => {
    test('should add user to allowlist', async () => {
      // Mock check if user exists (empty result means user not in allowlist)
      mockGet.mockResolvedValue({
        empty: true,
      });

      const res = await request(app)
        .post('/admin/add-user')
        .set('Authorization', 'Bearer validtoken')
        .send({ newUid: 'newUser' });

      expect(res.status).toBe(200);
      expect(mockAdd).toHaveBeenCalled();
    });

    test('should return 400 if user already in allowlist', async () => {
      mockGet.mockResolvedValue({
        empty: false,
      });

      const res = await request(app)
        .post('/admin/add-user')
        .set('Authorization', 'Bearer validtoken')
        .send({ newUid: 'existingUser' });

      expect(res.status).toBe(400);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    test('should return 403 for non-admin user', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'regularUser' });

      const res = await request(app)
        .post('/admin/add-user')
        .set('Authorization', 'Bearer validtoken')
        .send({ newUid: 'newUser' });

      expect(res.status).toBe(403);
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });
});
