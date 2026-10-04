import { query } from '../db/index.js';

export const JobDescriptionModel = {
  async create({ tenantId, userId, title, company, rawText, contentHash }, client = null) {
    const run = client ? client.query.bind(client) : query;
    const { rows } = await run(
      `INSERT INTO job_descriptions (tenant_id, user_id, title, company, raw_text, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, userId, title ?? null, company ?? null, rawText, contentHash]
    );
    return rows[0];
  },

  async findById({ id, tenantId }) {
    const { rows } = await query(
      'SELECT * FROM job_descriptions WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [id, tenantId]
    );
    return rows[0] ?? null;
  },
};

export default JobDescriptionModel;
