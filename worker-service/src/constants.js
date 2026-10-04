/** Pipeline stage names written to match_events - the frontend renders these. */
export const STAGES = Object.freeze({
  RECEIVED: 'received',
  DOWNLOADING: 'downloading_resume',
  EXTRACTING: 'extracting_text',
  EMBEDDING: 'embedding',
  RETRIEVING: 'retrieving_context',
  SCORING: 'scoring',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const TEMP_DIR = './public/temp';

/** Embedding task types understood by the Gemini embedding endpoint. */
export const EMBED_TASK = Object.freeze({
  DOCUMENT: 'RETRIEVAL_DOCUMENT',
  QUERY: 'RETRIEVAL_QUERY',
});

/** Gemini free tier is rate limited per minute - keep batches small and serial. */
export const EMBED_BATCH_SIZE = 16;
