import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { UserModel } from '../models/user.model.js';

/**
 * Verifies the JWT and attaches `req.user` plus `req.tenantId`.
 * Controllers must always use `req.tenantId` (never a tenant id from the body)
 * so a caller can never read another tenant's rows.
 */
export const verifyJWT = asyncHandler(async (req, _res, next) => {
  const bearer = req.header('Authorization')?.replace('Bearer ', '').trim();
  const token = req.cookies?.accessToken || bearer;

  if (!token) throw ApiError.unauthorized('Access token missing');

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }

  const user = await UserModel.findById(decoded.sub);
  if (!user) throw ApiError.unauthorized('User no longer exists');

  req.user = user;
  req.tenantId = user.tenant_id;
  next();
});

/** Role gate, e.g. router.delete('/:id', verifyJWT, requireRole('owner', 'admin'), ...) */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden('Insufficient role'));
    return next();
  };
