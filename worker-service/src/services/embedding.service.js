import { getRedis } from '../utils/redis.js';
import { embedTexts } from '../utils/gemini.js';
import { env } from '../envConfig.js';
import { logger } from '../utils/logger.js';
import { EMBED_BATCH_SIZE, EMBED_TASK } from '../constants.js';

/**
 * Embedding with a Redis read-through cache.
 *
 * Cache key = sha256(chunk text) plus the model and dimension, so changing
 * either automatically invalidates old vectors instead of mixing incompatible
 * embeddings in one index. This is what makes a duplicate upload nearly free:
 * the resume and the JD hash to the same chunks, every lookup hits Redis, and
 * the job never touches Gemini's quota.
 */
const cacheKey = (contentHash) =>
  `emb:v1:${env.GEMINI_EMBEDDING_MODEL}:${env.GEMINI_EMBEDDING_DIM}:${contentHash}`;

export const embedChunks = async (chunks, { taskType = EMBED_TASK.DOCUMENT } = {}) => {
  if (!chunks.length) return { chunks: [], cacheHits: 0, embedded: 0 };

  const redis = getRedis();
  const keys = chunks.map((c) => cacheKey(c.contentHash));

  let cached = [];
  try {
    cached = await redis.mget(keys);
  } catch (err) {
    // A cold cache is a performance problem, not a correctness one.
    logger.warn({ err: err.message }, 'redis mget failed - computing all embeddings');
    cached = keys.map(() => null);
  }

  const result = new Array(chunks.length);
  const misses = [];

  chunks.forEach((chunk, i) => {
    const raw = cached[i];
    if (raw) {
      try {
        result[i] = { ...chunk, embedding: JSON.parse(raw) };
        return;
      } catch {
        /* fall through to recompute */
      }
    }
    misses.push(i);
  });

  let embedded = 0;
  for (let start = 0; start < misses.length; start += EMBED_BATCH_SIZE) {
    const batchIdx = misses.slice(start, start + EMBED_BATCH_SIZE);
    const vectors = await embedTexts(
      batchIdx.map((i) => chunks[i].content),
      { taskType }
    );

    const pipeline = redis.pipeline();
    batchIdx.forEach((chunkIndex, j) => {
      const embedding = vectors[j];
      result[chunkIndex] = { ...chunks[chunkIndex], embedding };
      pipeline.set(
        cacheKey(chunks[chunkIndex].contentHash),
        JSON.stringify(embedding),
        'EX',
        env.EMBEDDING_CACHE_TTL_SECONDS
      );
    });
    await pipeline
      .exec()
      .catch((err) => logger.warn({ err: err.message }, 'redis cache write failed'));
    embedded += batchIdx.length;
  }

  const cacheHits = chunks.length - misses.length;
  logger.info({ total: chunks.length, cacheHits, embedded }, 'embeddings ready');

  return { chunks: result, cacheHits, embedded };
};

/** Centroid of a set of vectors, L2-normalised - used as the RAG query vector. */
export const centroid = (vectors) => {
  if (!vectors.length) throw new Error('Cannot compute centroid of zero vectors');
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) sum[i] += v[i];
  }
  const mean = sum.map((v) => v / vectors.length);
  const norm = Math.sqrt(mean.reduce((acc, v) => acc + v * v, 0)) || 1;
  return mean.map((v) => v / norm);
};

/** Cosine similarity - used for the deterministic baseline score in tests. */
export const cosineSimilarity = (a, b) => {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
};
