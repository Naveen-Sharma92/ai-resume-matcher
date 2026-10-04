import { jest } from '@jest/globals';
import { ApiError } from '../../src/utils/ApiError.js';
import { ApiResponse } from '../../src/utils/ApiResponse.js';
import { asyncHandler } from '../../src/utils/asyncHandler.js';
import { sha256, contentHash, normalizeText } from '../../src/utils/hash.js';

describe('ApiError', () => {
  it('carries a status code and marks the response unsuccessful', () => {
    const err = new ApiError(404, 'Nope');
    expect(err.statusCode).toBe(404);
    expect(err.success).toBe(false);
    expect(err.message).toBe('Nope');
    expect(err instanceof Error).toBe(true);
  });

  it('exposes named constructors with the right codes', () => {
    expect(ApiError.badRequest('x').statusCode).toBe(400);
    expect(ApiError.unauthorized().statusCode).toBe(401);
    expect(ApiError.forbidden().statusCode).toBe(403);
    expect(ApiError.notFound().statusCode).toBe(404);
    expect(ApiError.conflict().statusCode).toBe(409);
    expect(ApiError.tooManyRequests().statusCode).toBe(429);
  });

  it('serialises without leaking the stack', () => {
    const json = new ApiError(400, 'bad', [{ field: 'email' }]).toJSON();
    expect(json).toEqual({
      statusCode: 400,
      success: false,
      message: 'bad',
      errors: [{ field: 'email' }],
    });
    expect(json.stack).toBeUndefined();
  });
});

describe('ApiResponse', () => {
  it('flags 2xx as success and 4xx as failure', () => {
    expect(new ApiResponse(200, { a: 1 }).success).toBe(true);
    expect(new ApiResponse(202, {}).success).toBe(true);
    expect(new ApiResponse(400, {}).success).toBe(false);
  });
});

describe('asyncHandler', () => {
  it('forwards a rejected promise to next() instead of throwing', async () => {
    const next = jest.fn();
    const boom = new Error('boom');
    await asyncHandler(async () => {
      throw boom;
    })({}, {}, next);
    // let the microtask queue drain
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('does not call next on success', async () => {
    const next = jest.fn();
    const handler = jest.fn().mockResolvedValue('ok');
    await asyncHandler(handler)({}, {}, next);
    await Promise.resolve();
    expect(handler).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('hashing', () => {
  it('produces a stable 64 character sha256', () => {
    const digest = sha256('hello');
    expect(digest).toHaveLength(64);
    expect(digest).toBe(sha256('hello'));
  });

  it('normalises whitespace and case before hashing job descriptions', () => {
    expect(normalizeText('  Senior   BACKEND\nEngineer ')).toBe('senior backend engineer');
    // The same JD pasted with different spacing must hit the same cache entry.
    expect(contentHash('Node.js   and Kafka')).toBe(contentHash('node.js and kafka'));
  });

  it('gives different hashes to different content', () => {
    expect(contentHash('Kafka')).not.toBe(contentHash('RabbitMQ'));
  });
});
