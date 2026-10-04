import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { withTransaction } from '../db/index.js';
import { UserModel } from '../models/user.model.js';
import { TenantModel } from '../models/tenant.model.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/tokens.js';
import { COOKIE_OPTIONS } from '../constants.js';

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2),
  /** Join an existing workspace by slug, or omit to create a new one. */
  tenantSlug: z.string().min(2).max(40).optional(),
  tenantName: z.string().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().min(2).max(40),
});

const issueTokens = async (user) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await UserModel.setRefreshToken(user.id, refreshToken);
  return { accessToken, refreshToken };
};

const publicUser = (user) => ({
  id: user.id,
  tenantId: user.tenant_id,
  email: user.email,
  fullName: user.full_name,
  role: user.role,
});

/**
 * POST /api/v1/users/register
 * Creates the tenant (if new) and the user in one transaction: a half-created
 * workspace with no owner is not a state worth supporting.
 */
export const registerUser = asyncHandler(async (req, res) => {
  const { email, password, fullName, tenantSlug, tenantName } = registerSchema.parse(req.body);

  const slug = slugify(tenantSlug || tenantName || email.split('@')[1] || email);
  if (!slug) throw ApiError.badRequest('Could not derive a workspace slug');

  const result = await withTransaction(async (client) => {
    let tenant = await TenantModel.findBySlug(slug, client);
    let role = 'member';

    if (!tenant) {
      tenant = await TenantModel.create({ name: tenantName || slug, slug }, client);
      role = 'owner';
    }

    const { rows: existing } = await client.query(
      'SELECT id FROM users WHERE tenant_id = $1 AND email = $2',
      [tenant.id, email.toLowerCase()]
    );
    if (existing.length)
      throw ApiError.conflict('A user with this email already exists in this workspace');

    const passwordHash = await UserModel.hashPassword(password);
    const user = await UserModel.create(
      { tenantId: tenant.id, email, fullName, passwordHash, role },
      client
    );

    return { user, tenant };
  });

  const { accessToken, refreshToken } = await issueTokens({
    ...result.user,
    tenant_id: result.tenant.id,
  });

  return res
    .status(201)
    .cookie('accessToken', accessToken, COOKIE_OPTIONS)
    .cookie('refreshToken', refreshToken, COOKIE_OPTIONS)
    .json(
      new ApiResponse(
        201,
        {
          user: publicUser({ ...result.user, tenant_id: result.tenant.id }),
          tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug },
          accessToken,
          refreshToken,
        },
        'Account created'
      )
    );
});

/** POST /api/v1/users/login */
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password, tenantSlug } = loginSchema.parse(req.body);

  const tenant = await TenantModel.findBySlug(tenantSlug);
  if (!tenant) throw ApiError.unauthorized('Invalid credentials');

  const user = await UserModel.findByEmailWithSecret(email, tenant.id);
  if (!user) throw ApiError.unauthorized('Invalid credentials');

  const passwordOk = await UserModel.isPasswordCorrect(password, user.password_hash);
  if (!passwordOk) throw ApiError.unauthorized('Invalid credentials');

  const { accessToken, refreshToken } = await issueTokens(user);

  return res
    .status(200)
    .cookie('accessToken', accessToken, COOKIE_OPTIONS)
    .cookie('refreshToken', refreshToken, COOKIE_OPTIONS)
    .json(
      new ApiResponse(
        200,
        {
          user: publicUser(user),
          tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
          accessToken,
          refreshToken,
        },
        'Logged in'
      )
    );
});

/** POST /api/v1/users/logout */
export const logoutUser = asyncHandler(async (req, res) => {
  await UserModel.clearRefreshToken(req.user.id);
  return res
    .status(200)
    .clearCookie('accessToken', COOKIE_OPTIONS)
    .clearCookie('refreshToken', COOKIE_OPTIONS)
    .json(new ApiResponse(200, {}, 'Logged out'));
});

/** POST /api/v1/users/refresh-token */
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const incoming = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!incoming) throw ApiError.unauthorized('Refresh token missing');

  let decoded;
  try {
    decoded = verifyRefreshToken(incoming);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await UserModel.findByIdWithSecret(decoded.sub);
  if (!user || user.refresh_token !== incoming) {
    throw ApiError.unauthorized('Refresh token has been rotated');
  }

  const { accessToken, refreshToken } = await issueTokens(user);

  return res
    .status(200)
    .cookie('accessToken', accessToken, COOKIE_OPTIONS)
    .cookie('refreshToken', refreshToken, COOKIE_OPTIONS)
    .json(new ApiResponse(200, { accessToken, refreshToken }, 'Access token refreshed'));
});

/** GET /api/v1/users/current-user */
export const getCurrentUser = asyncHandler(async (req, res) =>
  res.status(200).json(new ApiResponse(200, { user: publicUser(req.user) }, 'Current user'))
);
