<p align="center">
  <img src="https://github.com/dzaharia1/Poetry-Cam-Frontend/raw/main/public/wordmark.svg" alt="Poetry Cam Wordmark" width="400">
</p>

# Poetry Cam Backend

The **Poetry Cam Backend** is a Node.js server that powers the Poetry Cam device. It acts as the bridge between the hardware (ESP32-S3), Google Gemini AI for vision-to-poetry generation, and Firebase for data persistence.

## Features

- **AI Image Processing**: Uses Google's `gemini-flash-latest` model to analyze captured images and generate evocative poems and color palettes.
- **Persistence**: Automatically saves generated poems and palettes to Firestore for later retrieval in the companion app.
- **Local Storage**: Caches the last captured image to the filesystem for debugging.
- **RESTful API**: Provides endpoints for image upload, poem retrieval, and history management.
- **Customizable Styles**: Supports different poem "types" via query parameters (e.g., standard, dirty limerick, haiku).

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **AI**: `@google/generative-ai` (Gemini API)
- **Database**: Firebase Firestore (`firebase-admin`)
- **File Handling**: Multer (for image uploads)
- **Dev Tools**: Nodemon

## Setup & Installation

### 1. Prerequisites
- Node.js (v18+)
- A Google Gemini API Key
- A Firebase Project with Firestore enabled

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory (based on `.env.example`):

```bash
GEMINI_API_KEY=your_api_key_here
FIREBASE_SERVICE_ACCOUNT_KEY=path/to/your/service-account.json
```

*Note: If you are deploying to a server, you can also paste the entire content of the service account JSON into the environment variable if you modify the initialization logic.*

### 4. Running the Server

The server runs on port `3109` by default.

**Development Mode (auto-reload):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

## API Endpoints

### Poetry Generation
`POST /generate-poem`
- **Body**: Multipart form-data with an `image` file OR raw `image/jpeg`.
- **Query Params**:
  - `userid` (string): Unique identifier for the user.
  - `type` (optional): `dirty-limerick` or `dirty-haiku`.
- **Response**:
  ```json
  {
    "title": "Evening Shadows",
    "poem": "Long shadows reach across the floor...",
    "palette": ["#2D3436", "#636E72", "#B2BEC3"]
  }
  ```

### Data Retrieval
- `GET /poemList?userid=ID&page=1`: Fetches a paginated list (50 per page) of poems for a user.
- `GET /getPoem?userid=ID&index=0`: Fetches a specific poem by index relative to the latest, along with "previous" and "next" for navigation.
- `GET /last-data`: Returns the most recently generated poem data (cached in memory).

### Management
- `DELETE /deletePoem?id=POEM_ID&userid=ID`: Deletes a specific poem from Firestore (verifies ownership).
- `GET /image/image.png`: Static delivery of the last uploaded image.

## Project Structure
- `server.js`: Main application logic and endpoint definitions.
- `systemPrompts.js`: The AI instructions for different poetry styles.
- `image/`: Directory where the last uploaded image is stored.
- `service-account-key.json`: (Not tracked) Your Firebase credentials.

