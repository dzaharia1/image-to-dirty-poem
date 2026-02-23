# CLAUDE.md — Poetry Cam Backend

This document gives AI assistants the context needed to work effectively in this codebase.

## Project Overview

Poetry Cam Backend is a Node.js REST API for an IoT poetry-generation device (the "Poetry Cam"). The device captures images and sends them to this backend, which uses Google Gemini to analyze each image and compose a short poem from it. Users can also generate charcoal-style sketch illustrations from their saved poems.

**Production URL:** `https://poetry-cam-backend.danmade.app`
**Default port:** `3109`

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules — `"type": "module"`) |
| Framework | Express.js 4 |
| AI | Google Gemini via `@google/generative-ai` |
| Auth & DB | Firebase Admin SDK (Firestore + Firebase Auth + Firebase Storage) |
| File upload | multer (in-memory storage) |
| Security | helmet, express-rate-limit (100 req/min), cors |
| Testing | Jest 30 + supertest |
| Dev server | nodemon |

---

## Directory Structure

```
poetry-cam-backend/
├── app.js                    # Express app factory (middleware + routes)
├── server.js                 # Entry point — binds to port 3109
├── systemPrompts.js          # All Gemini prompt strings (exported constants)
├── jest.config.js            # Jest config (no transform, node env)
├── .env.example              # Required environment variable template
│
├── config/
│   └── firebase.js           # Firebase Admin SDK init; exports db, storage
│
├── middleware/
│   ├── auth.js               # Firebase ID-token verification + allowlist gate
│   └── security.js           # helmet, rate-limit, CORS, Cloudflare no-transform
│
├── routes/
│   ├── poems.js              # Poem & sketch routes
│   ├── users.js              # User settings routes
│   └── admin.js              # Admin-only routes
│
├── controllers/
│   ├── poemController.js     # Business logic for all poem/sketch operations
│   ├── userController.js     # Settings get/update logic
│   └── adminController.js    # User listing and allowlist management
│
├── utils/
│   └── helpers.js            # formatDate(timezone) — timezone-aware date fields
│
└── tests/
    ├── integration/          # Supertest end-to-end tests per route group
    │   ├── poems.test.js
    │   ├── admin.test.js
    │   ├── users.test.js
    │   └── sketch.test.js
    ├── middleware/
    │   └── auth.test.js
    └── utils/
        └── helpers.test.js
```

---

## Development Workflows

### Setup

```bash
npm install
cp .env.example .env   # then fill in values
```

### Run (development)

```bash
npm run dev    # nodemon — auto-reloads on file changes
```

### Run (production)

```bash
npm start      # node /home/dan/services/poetry-cam-backend/server.js
```

### Tests

```bash
npm test       # cross-env NODE_OPTIONS=--experimental-vm-modules jest
```

The `--experimental-vm-modules` flag is required because the project uses ES modules and Jest needs it to mock them correctly.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Fallback Gemini API key (per-user keys take precedence) |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Yes* | Path to Firebase service account JSON file |
| `FIREBASE_PROJECT_ID` | Yes* | Alternative to service account file |
| `FIREBASE_CLIENT_EMAIL` | Yes* | Alternative to service account file |
| `FIREBASE_PRIVATE_KEY` | Yes* | Alternative to service account file |
| `FIREBASE_STORAGE_BUCKET` | No | Required for sketch generation (Firebase Storage) |
| `ADMIN_UID` | Yes | Firebase UID that has admin access |
| `PORT` | No | Server port (default: 3109) |

*Either `FIREBASE_SERVICE_ACCOUNT_KEY` (file path) OR the three individual credential variables must be set.

---

## Architecture & Key Conventions

### Middleware Order (app.js)

1. **Security** — `configureSecurity(app)`: helmet, rate-limit, CORS
2. **Body parsing** — `express.json()`
3. **Authentication** — `authenticate` middleware (global, with exceptions)
4. **Routes** — admin at `/admin`, users and poems at `/`

### Authentication Model

`middleware/auth.js` runs globally but skips these paths:
```
'/', '/favicon.ico', '/generate-poem', '/public/getPoem'
```

For all other routes the middleware:
1. Extracts a Firebase ID token from `Authorization: Bearer <token>`
2. Verifies it with `firebase-admin/auth`
3. Attaches `req.user = { uid, email }` to the request
4. Checks the verified UID against the in-memory allowlist (populated from the `allowlist` Firestore collection via a real-time `onSnapshot` listener)

`/generate-poem` uses **dual authentication** implemented inside the controller:
- **Token path** (web clients): manually verifies a Bearer token if the header is present
- **Query-param path** (Arduino): accepts `?userid=<uid>` and enforces allowlist

### Allowlist

Users must be in the Firestore `allowlist` collection (each document has a `uid` field) to access the API. The middleware caches this set in memory and updates it in real time.

### Per-User API Keys

Each allowlist document can store a `geminiApiKey`. When a user has their own key, it is used instead of the server-wide `GEMINI_API_KEY`. Always fetch the key from the allowlist document before calling Gemini.

### Firestore Collections

| Collection | Purpose |
|---|---|
| `poems` | All generated poems (fields: `userId`, `title`, `poem`, `palette`, `dayOfWeek`, `date`, `month`, `year`, `timestamp`, `isFavorite`, `penName`, `sketchUrl`) |
| `allowlist` | Permitted users (fields: `uid`, `geminiApiKey?`, `timezone?`, `penName?`, `themeMode?`) |

Ownership is enforced at the controller level: every mutating operation on a poem document verifies `doc.data().userId === req.user.uid`.

### Gemini Models

| Model | Used for |
|---|---|
| `gemini-flash-latest` | Poem generation (JSON mode via `responseMimeType: "application/json"`) |
| `gemini-2.5-flash-image` | Sketch generation (image output from text prompt) |

All Gemini prompts live in `systemPrompts.js` as named exports. Never inline prompts in controllers.

### Poem Generation Response Format

The Gemini model returns (and the API echoes back) a JSON object:
```json
{
  "title": "string",
  "poem": "string (\\n for line breaks)",
  "palette": ["#hex1", "#hex2", ...],
  "dayOfWeek": "string",
  "date": "number",
  "month": "string",
  "year": "number"
}
```

The date fields are added by `formatDate(userTimezone)` from `utils/helpers.js` after Gemini responds.

### Sketch Generation

Sketches require the user to have their own `geminiApiKey` in their allowlist document — the global key is not used. The generated image is stored in Firebase Storage at `sketches/<poemId>.png`, made public, and its URL saved back to the poem document.

---

## API Reference

### Public Endpoints (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check — returns `"Poetry Cam Backend"` |
| `GET` | `/public/getPoem` | Get poem by index for any user (`?userid=`, `?index=`, `?favoritesOnly=`, `?sortByDate=`) |

### Poem Endpoints (Bearer token required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate-poem` | Generate poem from image (dual auth; see above) |
| `GET` | `/poemList` | Paginated poem list (`?page=`, `?sortByDate=`) — 50 per page |
| `GET` | `/getPoem` | Single poem with prev/next navigation (`?index=`, `?favoritesOnly=`, `?sortByDate=`) |
| `POST` | `/toggleFavorite` | Toggle/set favorite (`body: {id, status?}`) |
| `DELETE` | `/deletePoem` | Delete poem (`?id=`) |
| `POST` | `/generate-sketch` | Generate sketch image (`body: {id, title, poem}`) |

`/generate-poem` accepts either:
- Multipart form-data with an `image` field (multer parses this)
- Raw binary JPEG body (Arduino sends this)

### User Settings Endpoints (Bearer token required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/get-settings` | Returns `{timezone, themeMode, penName, hasGeminiApiKey}` — never returns the raw key |
| `POST` | `/update-settings` | Updates settings (`body: {settings: {timezone?, themeMode?, penName?, geminiApiKey?}}`) |

### Admin Endpoints (Bearer token + ADMIN_UID env var required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/users` | List allowed users and others |
| `POST` | `/admin/add-user` | Add UID to allowlist (`body: {newUid}`) |

---

## Testing Conventions

### Running a single test file

```bash
npm test -- tests/integration/poems.test.js
```

### Mocking strategy

All external dependencies are mocked with `jest.unstable_mockModule` (required for ES modules):

```js
// Mock Firebase before importing app
jest.unstable_mockModule('../config/firebase.js', () => ({
  db: mockDb,
  storage: mockStorage,
}));

// Then dynamically import the module under test
const { default: app } = await import('../app.js');
```

Gemini mocks use a chainable pattern to mirror the real SDK:
```js
const mockGenerateContent = jest.fn().mockResolvedValue({
  response: { text: () => JSON.stringify({ title: '...', poem: '...', palette: [] }) }
});
mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent });
```

### Test structure

Each integration test file:
1. Mocks Firebase and Gemini at the top using `jest.unstable_mockModule`
2. Imports `app` via dynamic `import()` inside a `beforeAll` or at module level after mocks
3. Uses `supertest(app)` for HTTP assertions
4. Sets `Authorization: Bearer test-token` on authenticated requests (the mock bypasses real verification)

---

## Common Pitfalls

- **ES module mocking**: Always use `jest.unstable_mockModule` (not `jest.mock`) and place it before any dynamic `import()` of the module under test.
- **`/generate-poem` auth**: This route is excluded from the global `authenticate` middleware. Its auth logic is entirely inside `poemController.generatePoem`. Don't assume `req.user` is populated.
- **Sketch generation requires a user API key**: The global `GEMINI_API_KEY` is not used for sketches. If the allowlist document has no `geminiApiKey`, the endpoint returns 400.
- **Firestore composite indexes**: `poemList` and `getPoem` queries combine `where` + `orderBy` on multiple fields. Firestore requires composite indexes for these; if queries fail in a new Firebase project, create the indexes in the Firebase console.
- **Response before Firestore save**: `generatePoem` sends the HTTP response to the client before saving to Firestore (fire-and-forget). Errors in the DB write are logged but do not affect the response.
