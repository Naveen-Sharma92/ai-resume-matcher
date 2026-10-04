import { Router } from 'express';
import {
  createMatch,
  getMatchStatus,
  getMatchResult,
  listMatches,
} from '../controllers/match.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { upload } from '../middlewares/multer.middleware.js';
import { rateLimiter } from '../middlewares/rateLimit.middleware.js';

const router = Router();

router.use(verifyJWT);

// Uploads are the expensive path (S3 + Gemini downstream), so they get a much
// smaller budget than the polling endpoints.
const uploadLimiter = rateLimiter({ max: 10, windowSeconds: 300, prefix: 'rl:upload' });
const pollLimiter = rateLimiter({ max: 120, windowSeconds: 60, prefix: 'rl:poll' });

router.route('/').post(uploadLimiter, upload.single('resume'), createMatch).get(listMatches);
router.route('/:id').get(pollLimiter, getMatchResult);
router.route('/:id/status').get(pollLimiter, getMatchStatus);

export default router;
