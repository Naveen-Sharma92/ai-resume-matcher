import { OWNER_TYPE, RAG_TOP_K } from '@arm/shared/constants';
import { EmbeddingModel } from '../models/embedding.model.js';
import { centroid } from './embedding.service.js';
import { logger } from '../utils/logger.js';

/**
 * Retrieval step.
 *
 * Two passes, then dedupe:
 *  1. The JD centroid finds the resume chunks that match the role overall.
 *  2. Each individual JD chunk finds its own best resume chunks, so a single
 *     hard requirement buried in a long JD still pulls in its evidence instead
 *     of being averaged away by the centroid.
 *
 * The similarity scores travel into the prompt: telling the model how strong
 * each retrieved piece of evidence is measurably reduces invented matches.
 */
export const retrieveResumeContext = async ({
  tenantId,
  resumeId,
  jdChunks,
  topK = RAG_TOP_K,
  perChunkK = 2,
}) => {
  const jdVectors = jdChunks.map((c) => c.embedding);
  const queryVector = centroid(jdVectors);

  const found = new Map();

  const collect = (rows, source) => {
    for (const row of rows) {
      const existing = found.get(row.chunk_index);
      if (!existing || Number(row.similarity) > Number(existing.similarity)) {
        found.set(row.chunk_index, { ...row, source });
      }
    }
  };

  collect(
    await EmbeddingModel.searchSimilarChunks({
      tenantId,
      ownerType: OWNER_TYPE.RESUME,
      ownerId: resumeId,
      queryEmbedding: queryVector,
      topK,
    }),
    'centroid'
  );

  // Cap the fan-out: 5 extra similarity queries is plenty and keeps the job
  // well inside Supabase's free-tier connection budget.
  for (const chunk of jdChunks.slice(0, 5)) {
    collect(
      await EmbeddingModel.searchSimilarChunks({
        tenantId,
        ownerType: OWNER_TYPE.RESUME,
        ownerId: resumeId,
        queryEmbedding: chunk.embedding,
        topK: perChunkK,
      }),
      `jd_chunk_${chunk.index}`
    );
  }

  const context = [...found.values()]
    .sort((a, b) => Number(b.similarity) - Number(a.similarity))
    .slice(0, topK + 2);

  logger.info(
    { resumeId, retrieved: context.length, best: context[0]?.similarity },
    'rag context retrieved'
  );

  return { context, queryVector };
};

/** Average of the top-N retrieval similarities: a model-free sanity baseline. */
export const retrievalConfidence = (context, n = 3) => {
  if (!context.length) return 0;
  const top = context.slice(0, n).map((c) => Number(c.similarity));
  return top.reduce((a, b) => a + b, 0) / top.length;
};
