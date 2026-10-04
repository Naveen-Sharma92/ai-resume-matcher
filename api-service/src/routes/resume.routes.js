import { Router } from 'express';
import { listResumes, getResumeDownloadUrl } from '../controllers/resume.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyJWT);
router.route('/').get(listResumes);
router.route('/:id/download').get(getResumeDownloadUrl);

export default router;
