export const API_PREFIX = '/api/v1';

export const DB_NAME = 'resume_matcher';

/** Multer keeps the upload here briefly before it is pushed to S3 and unlinked. */
export const TEMP_UPLOAD_DIR = './public/temp';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

/** S3 key layout keeps tenants isolated by prefix, which makes IAM policies easy. */
export const s3ResumeKey = ({ tenantId, resumeId, extension }) =>
  `tenants/${tenantId}/resumes/${resumeId}${extension}`;

export const MAX_JD_LENGTH = 25000;
export const MIN_JD_LENGTH = 50;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
