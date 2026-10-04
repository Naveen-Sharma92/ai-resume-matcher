import jwt from 'jsonwebtoken';
import { env } from '../envConfig.js';

/**
 * Access token carries the tenant so every downstream query can be scoped
 * without another DB round trip. Refresh token stays minimal on purpose.
 */
export const generateAccessToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
    },
    env.ACCESS_TOKEN_SECRET,
    { expiresIn: env.ACCESS_TOKEN_EXPIRY }
  );

export const generateRefreshToken = (user) =>
  jwt.sign({ sub: user.id }, env.REFRESH_TOKEN_SECRET, { expiresIn: env.REFRESH_TOKEN_EXPIRY });

export const verifyAccessToken = (token) => jwt.verify(token, env.ACCESS_TOKEN_SECRET);

export const verifyRefreshToken = (token) => jwt.verify(token, env.REFRESH_TOKEN_SECRET);
