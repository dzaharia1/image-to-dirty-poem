import { jest } from '@jest/globals';

let snapshotCallback = null;

// Define mocks first, before any imports
const mockDb = {
  collection: jest.fn().mockReturnThis(),
  onSnapshot: jest.fn((cb) => {
    snapshotCallback = cb;
    return () => {}; // unsubscribe function
  }),
};

const mockGetAuth = jest.fn();
const mockVerifyIdToken = jest.fn();

// Use unstable_mockModule for ESM mocking
jest.unstable_mockModule('../../config/firebase.js', () => ({
  db: mockDb,
}));

jest.unstable_mockModule('firebase-admin/auth', () => ({
  getAuth: mockGetAuth,
}));

// Now import the module under test
const { authenticate } = await import('../../middleware/auth.js');

describe('Authentication Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup request, response, next mocks
    req = {
      path: '/some/protected/route',
      headers: {},
      query: {},
      body: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    next = jest.fn();

    // Mock getAuth implementation
    mockGetAuth.mockReturnValue({
      verifyIdToken: mockVerifyIdToken,
    });
  });

  test('should skip auth for public paths', async () => {
    req.path = '/';
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  test('should return 401 if no Authorization header', async () => {
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required: Missing or invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should return 401 if Authorization header is invalid', async () => {
    req.headers.authorization = 'InvalidFormat token';
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required: Missing or invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should verify token successfully and call next if allowlist is empty', async () => {
    // Ensure allowlist is empty.
    // We can clear it by invoking callback with empty list if needed, or rely on initial state.
    // Initial state: snapshotCallback might have been called? No, only registered.
    // If not called, allowedUserIds is empty Set.

    req.headers.authorization = 'Bearer validtoken';
    mockVerifyIdToken.mockResolvedValue({ uid: 'user123', email: 'test@example.com' });

    await authenticate(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith('validtoken');
    expect(req.user).toEqual({ uid: 'user123', email: 'test@example.com' });
    expect(next).toHaveBeenCalled();
  });

  test('should verify token but block user if not in allowlist', async () => {
    // Populate allowlist via snapshot callback
    if (snapshotCallback) {
      const mockSnapshot = [
        { data: () => ({ uid: 'allowedUser' }) },
      ];
      // Mock forEach on the snapshot array/object
      mockSnapshot.forEach = Array.prototype.forEach;

      snapshotCallback(mockSnapshot);
    }

    req.headers.authorization = 'Bearer validtoken';
    mockVerifyIdToken.mockResolvedValue({ uid: 'blockedUser', email: 'blocked@example.com' });

    await authenticate(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith('validtoken');
    expect(req.user).toEqual({ uid: 'blockedUser', email: 'blocked@example.com' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should allow user if in allowlist', async () => {
    // Allowlist already populated from previous test if using same module instance.
    // To be safe, re-populate.
    if (snapshotCallback) {
      const mockSnapshot = [
        { data: () => ({ uid: 'allowedUser' }) },
      ];
      mockSnapshot.forEach = Array.prototype.forEach;
      snapshotCallback(mockSnapshot);
    }

    req.headers.authorization = 'Bearer validtoken';
    mockVerifyIdToken.mockResolvedValue({ uid: 'allowedUser', email: 'allowed@example.com' });

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should return 401 if token verification fails', async () => {
    req.headers.authorization = 'Bearer invalidtoken';
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authentication token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should return 401 if token expired', async () => {
    req.headers.authorization = 'Bearer expiredtoken';
    const error = new Error('Token expired');
    error.code = 'auth/id-token-expired';
    mockVerifyIdToken.mockRejectedValue(error);

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    expect(next).not.toHaveBeenCalled();
  });
});
