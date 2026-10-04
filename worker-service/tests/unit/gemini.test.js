import {
  fitDimensions,
  parseJsonLoose,
  GeminiError,
  isDailyQuotaError,
} from '../../src/utils/gemini.js';

describe('fitDimensions', () => {
  it('passes a correctly sized vector through untouched', () => {
    const vector = [0.1, 0.2, 0.3];
    expect(fitDimensions(vector, 3)).toEqual(vector);
  });

  it('truncates a longer vector and renormalises it to unit length', () => {
    const fitted = fitDimensions([3, 4, 99, 99], 2);
    expect(fitted).toHaveLength(2);
    const norm = Math.sqrt(fitted[0] ** 2 + fitted[1] ** 2);
    expect(norm).toBeCloseTo(1, 6);
  });

  it('refuses to pad a vector that is too short', () => {
    expect(() => fitDimensions([1, 2], 768)).toThrow(GeminiError);
  });
});

describe('parseJsonLoose', () => {
  it('parses clean JSON', () => {
    expect(parseJsonLoose('{"score": 80}')).toEqual({ score: 80 });
  });

  it('survives a markdown code fence', () => {
    expect(parseJsonLoose('```json\n{"score": 72}\n```')).toEqual({ score: 72 });
  });

  it('extracts the object when the model adds chatter around it', () => {
    expect(parseJsonLoose('Here you go: {"score": 55} hope that helps')).toEqual({ score: 55 });
  });

  it('throws a typed error on unparseable output', () => {
    expect(() => parseJsonLoose('no json at all')).toThrow(GeminiError);
  });
});

describe('isDailyQuotaError', () => {
  const dailyQuotaBody = JSON.stringify({
    error: {
      code: 429,
      message:
        'You exceeded your current quota. Quota exceeded for metric: ' +
        'generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20',
    },
  });

  it('recognises an exhausted daily free-tier allowance', () => {
    expect(isDailyQuotaError(429, dailyQuotaBody)).toBe(true);
  });

  it('does NOT flag an ordinary per-minute rate limit, which backoff can fix', () => {
    const perMinuteBody = JSON.stringify({
      error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).' },
    });
    expect(isDailyQuotaError(429, perMinuteBody)).toBe(false);
  });

  it('ignores non-429 responses entirely', () => {
    expect(isDailyQuotaError(503, 'free_tier_requests')).toBe(false);
    expect(isDailyQuotaError(500, '')).toBe(false);
  });

  it('tolerates a missing body', () => {
    expect(isDailyQuotaError(429)).toBe(false);
  });
});

describe('GeminiError', () => {
  it('carries a permanent flag so the worker can skip pointless retries', () => {
    expect(new GeminiError('x', { status: 429, permanent: true }).permanent).toBe(true);
    expect(new GeminiError('x', { status: 429 }).permanent).toBe(false);
  });
});
