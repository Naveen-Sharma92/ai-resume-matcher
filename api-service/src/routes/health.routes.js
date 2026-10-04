import { Router } from 'express';
import { readiness } from '../controllers/health.controller.js';

const router = Router();
router.route('/ready').get(readiness);

export default router;
