import { query } from '../db/index.js';
import { EMBEDDING_DIMENSIONS } from '@arm/shared/constants';

/** pgvector accepts a bracketed literal: '[0.1,0.2,...]'::vector */
export const toVectorLiteral = (values) => `[${values.join(',')}]`;

export const EmbeddingModel = {
  async countForOwner({ tenantId, ownerType, ownerId }) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count
         FROM embeddings
        WHERE tenant_id = $1 AND owner_type = $2 AND owner_id = $3`,
      [tenantId, ownerType, ownerId]
    );
    return rows[0].count;
  },

  /**
   * Bulk insert chunk embeddings. ON CONFLICT DO NOTHING makes the whole
   * pipeline safely re-runnable: Kafka gives at-least-once delivery, so the
   * same event can legitimately arrive twice.
   */
  async insertMany({ tenantId, ownerType, ownerId, chunks }) {
    if (!chunks.length) return 0;

    const values = [];
    const params = [];
    chunks.forEach((chunk, i) => {
      const base = i * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::vector)`
      );
      params.push(
        tenantId,
        ownerType,
        ownerId,
        chunk.index,
        chunk.content,
        chunk.contentHash,
        toVectorLiteral(chunk.embedding)
      );
    });

    const { rowCount } = await query(
      `INSERT INTO embeddings
         (tenant_id, owner_type, owner_id, chunk_index, content, content_hash, embedding)
       VALUES ${values.join(', ')}
       ON CONFLICT (owner_type, owner_id, chunk_index) DO NOTHING`,
      params
    );
    return rowCount;
  },

  /**
   * RAG retrieval: cosine similarity against one query vector, scoped to a
   * single owner (this resume) and tenant.
   *
   * `<=>` is pgvector's cosine *distance*, so similarity = 1 - distance and
   * ordering ascending by distance gives the closest chunks first. The HNSW
   * index in 001_init.sql is built with vector_cosine_ops to match.
   */
  async searchSimilarChunks({ tenantId, ownerType, ownerId, queryEmbedding, topK = 6 }) {
    if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Query embedding has ${queryEmbedding.length} dims, expected ${EMBEDDING_DIMENSIONS}`
      );
    }
    const { rows } = await query(
      `SELECT chunk_index, content, 1 - (embedding <=> $4::vector) AS similarity
         FROM embeddings
        WHERE tenant_id = $1 AND owner_type = $2 AND owner_id = $3
        ORDER BY embedding <=> $4::vector
        LIMIT $5`,
      [tenantId, ownerType, ownerId, toVectorLiteral(queryEmbedding), topK]
    );
    return rows;
  },

  async deleteForOwner({ tenantId, ownerType, ownerId }) {
    await query(
      'DELETE FROM embeddings WHERE tenant_id = $1 AND owner_type = $2 AND owner_id = $3',
      [tenantId, ownerType, ownerId]
    );
  },
};

export default EmbeddingModel;
