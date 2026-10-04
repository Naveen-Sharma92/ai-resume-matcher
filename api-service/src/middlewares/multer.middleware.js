import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { TEMP_UPLOAD_DIR } from '../constants.js';
import { SUPPORTED_RESUME_MIME_TYPES, MAX_RESUME_SIZE_BYTES } from '@arm/shared/constants';
import { ApiError } from '../utils/ApiError.js';

fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

/**
 * Disk storage (chai-backend pattern): multer drops the file in public/temp,
 * the controller streams it to S3 and unlinks it. Keeps memory flat even if
 * several people upload at once on a 512 MB Render instance.
 */
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!SUPPORTED_RESUME_MIME_TYPES.includes(file.mimetype)) {
    return cb(ApiError.badRequest('Only PDF and DOCX resumes are supported'));
  }
  return cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_RESUME_SIZE_BYTES, files: 1 },
});

export default upload;
