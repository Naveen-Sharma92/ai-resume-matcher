import { query } from '../db/index.js';
import { MATCH_STATUS } from '@arm/shared/constants';

const RESULT_COLUMNS = `
  m.id,
  m.tenant_id,
  m.user_id,
  m.resume_id,
  m.job_description_id,
  m.status,
  m.score,
  m.summary,
  m.matched_skills,
  m.missing_skills,
  m.suggestions,
  m.model,
  m.latency_ms,
  m.attempts,
  m.error,
  m.created_at,
  m.updated_at
`;

export const MatchResultModel = {
  async create({ tenantId, userId, resumeId, jobDescriptionId }, client = null) {
    const run = client ? client.query.bind(client) : query;
    const { rows } = await run(
      `INSERT INTO match_results (tenant_id, user_id, resume_id, job_description_id, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, userId, resumeId, jobDescriptionId, MATCH_STATUS.QUEUED]
    );
    return rows[0];
  },

  async findById({ id, tenantId }) {
    const { rows } = await query(
      `SELECT ${RESULT_COLUMNS},
              r.original_filename AS resume_filename,
              j.title AS job_title,
              j.company AS job_company
         FROM match_results m
         JOIN resumes r ON r.id = m.resume_id
         JOIN job_descriptions j ON j.id = m.job_description_id
        WHERE m.id = $1 AND m.tenant_id = $2
        LIMIT 1`,
      [id, tenantId]
    );
    return rows[0] ?? null;
  },

  async findStatusById({ id, tenantId }) {
    const { rows } = await query(
      `SELECT id, status, attempts, error, created_at, updated_at
         FROM match_results
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [id, tenantId]
    );
    return rows[0] ?? null;
  },

  async listByUser({ tenantId, userId, limit = 20, offset = 0 }) {
    const { rows } = await query(
      `SELECT m.id, m.status, m.score, m.created_at, m.updated_at,
              r.original_filename AS resume_filename,
              j.title AS job_title, j.company AS job_company
         FROM match_results m
         JOIN resumes r ON r.id = m.resume_id
         JOIN job_descriptions j ON j.id = m.job_description_id
        WHERE m.tenant_id = $1 AND m.user_id = $2
        ORDER BY m.created_at DESC
        LIMIT $3 OFFSET $4`,
      [tenantId, userId, limit, offset]
    );
    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS total FROM match_results WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId]
    );
    return { items: rows, total: countRows[0].total };
  },

  /** Append-only timeline row; the status endpoint returns these as `timeline`. */
  async addEvent({ tenantId, matchId, stage, message = null, metadata = {} }, client = null) {
    const run = client ? client.query.bind(client) : query;
    await run(
      `INSERT INTO match_events (tenant_id, match_id, stage, message, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, matchId, stage, message, JSON.stringify(metadata)]
    );
  },

  async listEvents({ tenantId, matchId }) {
    const { rows } = await query(
      `SELECT stage, message, metadata, created_at
         FROM match_events
        WHERE tenant_id = $1 AND match_id = $2
        ORDER BY id ASC`,
      [tenantId, matchId]
    );
    return rows;
  },
};

export default MatchResultModel;
