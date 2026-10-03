import { Router } from 'express';
import {
  getCurrentUser,
  login,
  register,
  rotateApiKey,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, getCurrentUser);
router.post('/api-key/rotate', requireAuth, rotateApiKey);

export default router;
