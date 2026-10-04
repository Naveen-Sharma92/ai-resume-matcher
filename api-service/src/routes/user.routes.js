import { Router } from 'express';
import {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
} from '../controllers/user.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { rateLimiter } from '../middlewares/rateLimit.middleware.js';

const router = Router();

// Auth endpoints get their own tighter bucket - brute forcing a password
// should run out of budget long before it runs out of guesses.
const authLimiter = rateLimiter({ max: 10, windowSeconds: 60, prefix: 'rl:auth' });

router.route('/register').post(authLimiter, registerUser);
router.route('/login').post(authLimiter, loginUser);
router.route('/refresh-token').post(authLimiter, refreshAccessToken);

// secured
router.route('/logout').post(verifyJWT, logoutUser);
router.route('/current-user').get(verifyJWT, getCurrentUser);

export default router;
