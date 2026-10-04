/**
 * Values shared by api-service and worker-service.
 * Anything that both services must agree on lives here so the two
 * deployments can never drift apart.
 */

export const MATCH_STATUS = Object.freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const OWNER_TYPE = Object.freeze({
  RESUME: 'resume',
  JOB_DESCRIPTION: 'job_description',
});

/** Terminal states: the frontend can stop polling once it sees one of these. */
export const TERMINAL_MATCH_STATUSES = Object.freeze([MATCH_STATUS.COMPLETED, MATCH_STATUS.FAILED]);

/** Supported resume mime types (PDF + DOCX only). */
export const SUPPORTED_RESUME_MIME_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Embedding dimensionality requested from Gemini and used by the
 * `vector(...)` column in Postgres. Keep this in sync with db/migrations.
 */
export const EMBEDDING_DIMENSIONS = 768;

/** RAG tuning knobs. */
export const CHUNK_SIZE_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 200;
export const RAG_TOP_K = 6;
