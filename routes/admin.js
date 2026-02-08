import express from 'express';
import { getUsers, addUser } from '../controllers/adminController.js';

const router = express.Router();

// Admin Routes
router.get('/users', getUsers);
router.post('/add-user', addUser);

export default router;
