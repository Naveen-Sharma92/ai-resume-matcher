import { query } from '../db/index.js';

/**
 * Tenant = the unit of isolation. A signup either joins an existing tenant
 * (by slug) or creates a new one, and every other table hangs off tenant_id.
 */
export const TenantModel = {
  async findBySlug(slug, client = null) {
    const run = client ? client.query.bind(client) : query;
    const { rows } = await run('SELECT * FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
    return rows[0] ?? null;
  },

  async findById(id) {
    const { rows } = await query('SELECT * FROM tenants WHERE id = $1 LIMIT 1', [id]);
    return rows[0] ?? null;
  },

  async create({ name, slug, plan = 'free' }, client = null) {
    const run = client ? client.query.bind(client) : query;
    const { rows } = await run(
      `INSERT INTO tenants (name, slug, plan)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, slug, plan]
    );
    return rows[0];
  },
};

export default TenantModel;
