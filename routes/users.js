import express from 'express';
import { getSettings, updateSettings, usesWebDisplay, setWebDisplayPoem } from '../controllers/userController.js';

const router = express.Router();

// User Routes
router.get('/get-settings', getSettings);
router.post('/update-settings', updateSettings);
router.get('/uses-web-display', usesWebDisplay);
router.post('/set-web-display-poem', setWebDisplayPoem);

export default router;
