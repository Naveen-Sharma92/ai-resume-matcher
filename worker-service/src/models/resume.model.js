import { query } from '../db/index.js';

export const ResumeModel = {
  async findById({ id, tenantId }) {
    const { rows } = await query('SELECT * FROM resumes WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
      id,
      tenantId,
    ]);
    return rows[0] ?? null;
  },

  /** Cache the extracted text on the row so a re-run never re-parses the PDF. */
  async saveParsedText({ id, tenantId, text }) {
    const { rows } = await query(
      `UPDATE resumes
          SET parsed_text = $3, parsed_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING id`,
      [id, tenantId, text]
    );
    return rows[0] ?? null;
  },

  /**
   * Text already extracted from an identical file (same sha256) anywhere in
   * this tenant - reuse it instead of downloading and parsing again.
   */
  async findParsedTextByHash({ tenantId, contentHash }) {
    const { rows } = await query(
      `SELECT parsed_text
         FROM resumes
        WHERE tenant_id = $1 AND content_hash = $2 AND parsed_text IS NOT NULL
        ORDER BY parsed_at DESC
        LIMIT 1`,
      [tenantId, contentHash]
    );
    return rows[0]?.parsed_text ?? null;
  },
};

export default ResumeModel;
