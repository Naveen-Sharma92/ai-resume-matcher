import bcrypt from 'bcrypt';
import { query } from '../db/index.js';

const SALT_ROUNDS = 10;
const PUBLIC_COLUMNS = 'id, tenant_id, email, full_name, role, last_login_at, created_at';

export const UserModel = {
  hashPassword: (plain) => bcrypt.hash(plain, SALT_ROUNDS),

  isPasswordCorrect: (plain, hash) => bcrypt.compare(plain, hash),

  async create({ tenantId, email, fullName, passwordHash, role = 'member' }, client = null) {
    const run = client ? client.query.bind(client) : query;
    const { rows } = await run(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${PUBLIC_COLUMNS}`,
      [tenantId, email.toLowerCase(), fullName, passwordHash, role]
    );
    return rows[0];
  },

  /** Includes password_hash - only for the login path. */
  async findByEmailWithSecret(email, tenantId) {
    const { rows } = await query(
      'SELECT * FROM users WHERE tenant_id = $1 AND email = $2 LIMIT 1',
      [tenantId, email.toLowerCase()]
    );
    return rows[0] ?? null;
  },

  async findById(id) {
    const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ?? null;
  },

  async findByIdWithSecret(id) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return rows[0] ?? null;
  },

  async setRefreshToken(id, refreshToken) {
    await query('UPDATE users SET refresh_token = $2, last_login_at = NOW() WHERE id = $1', [
      id,
      refreshToken,
    ]);
  },

  async clearRefreshToken(id) {
    await query('UPDATE users SET refresh_token = NULL WHERE id = $1', [id]);
  },
};

export default UserModel;
