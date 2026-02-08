import express from 'express';
import { getSettings, updateSettings } from '../controllers/userController.js';

const router = express.Router();

// User Routes
router.get('/get-settings', getSettings);
router.post('/update-settings', updateSettings);

export default router;
