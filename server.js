// all of the server configuration and logic is in app.js for easier testing
import app from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const port = process.env.PORT || 3109;

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
