import express from 'express';
import multer from 'multer';
import { listPoems, getPoem, getPublicPoem, toggleFavorite, deletePoem, generatePoem, generateSketch } from '../controllers/poemController.js';

const router = express.Router();

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Poem Routes
router.get('/poemList', listPoems);
router.get('/getPoem', getPoem);
router.get('/public/getPoem', getPublicPoem);

router.post('/generate-poem', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('image/jpeg')) {
    express.raw({ type: 'image/jpeg', limit: '10mb' })(req, res, next);
  } else {
    upload.single('image')(req, res, next);
  }
}, generatePoem);

router.post('/generate-sketch', generateSketch);
router.post('/toggleFavorite', toggleFavorite);
router.delete('/deletePoem', deletePoem);

export default router;
