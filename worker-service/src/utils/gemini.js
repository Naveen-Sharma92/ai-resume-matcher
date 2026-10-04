import { env } from '../envConfig.js';
import { logger } from './logger.js';

/**
 * Minimal Gemini REST client (no SDK).
 *
 * Two reasons for hand-rolling it: the free tier's failure modes (429 with
 * RetryInfo, 503 overloaded) need explicit backoff, and a thin fetch wrapper is
 * trivial to mock in Jest.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

class GeminiError extends Error {
  constructor(message, { status, body, permanent = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.body = body;
    // Set when retrying cannot possibly help, so the worker fails fast instead
    // of spending its attempt budget.
    this.permanent = permanent;
  }
}

/**
 * Gemini returns 429 for two very different things:
 *   - per-minute rate limiting, which backoff fixes
 *   - the daily free-tier allowance, which backoff cannot fix until it resets
 * Only the first is worth retrying.
 */
const DAILY_QUOTA_MARKERS = [
  'free_tier_requests',
  'PerDay',
  'per day',
  'GenerateRequestsPerDayPerProjectPerModel',
];

export const isDailyQuotaError = (status, body = '') =>
  status === 429 && DAILY_QUOTA_MARKERS.some((marker) => String(body).includes(marker));

async function callGemini(path, body, { timeoutMs = env.GEMINI_TIMEOUT_MS } = {}) {
  const url = `${env.GEMINI_BASE_URL}/${path}`;
  let lastError;

  for (let attempt = 0; attempt <= env.GEMINI_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) return await response.json();

      const text = await response.text();

      if (isDailyQuotaError(response.status, text)) {
        throw new GeminiError(
          `Gemini daily free-tier quota exhausted for ${env.GEMINI_CHAT_MODEL}. ` +
            'It resets at midnight Pacific time, or switch GEMINI_CHAT_MODEL to a ' +
            'model with a higher free-tier allowance.',
          { status: response.status, body: text, permanent: true }
        );
      }

      lastError = new GeminiError(`Gemini ${response.status}: ${text.slice(0, 400)}`, {
        status: response.status,
        body: text,
      });

      if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
    } catch (err) {
      lastError = err instanceof GeminiError ? err : new GeminiError(err.message);
      if (err.permanent) throw err;
      if (err.name === 'GeminiError' && err.status && !RETRYABLE_STATUS.has(err.status)) throw err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < env.GEMINI_MAX_RETRIES) {
      // Exponential backoff with jitter - the free tier is per-minute quota'd,
      // so backing off is usually enough to get through.
      const delay = Math.min(2 ** attempt * 1000, 16_000) + Math.random() * 500;
      logger.warn({ attempt, delay, err: lastError.message }, 'gemini call failed, retrying');
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * L2-normalised truncation (Matryoshka style).
 * Embedding models return a fixed width; if that is wider than the vector(...)
 * column, the leading dimensions carry most of the signal, so slice and
 * renormalise rather than failing the job.
 */
export const fitDimensions = (values, dim) => {
  if (values.length === dim) return values;
  if (values.length < dim) {
    throw new GeminiError(`Embedding has ${values.length} dims, need ${dim}`);
  }
  const sliced = values.slice(0, dim);
  const norm = Math.sqrt(sliced.reduce((acc, v) => acc + v * v, 0)) || 1;
  return sliced.map((v) => v / norm);
};

/**
 * Some embedding models (gemini-embedding-001 among them) accept only ONE
 * input per request and reject batchEmbedContents outright. We try the batch
 * endpoint first and, on a 400, drop to serial calls for the rest of the
 * process - one slow path beats failing the job.
 */
let serialEmbedMode = false;

const embedOne = async (text, taskType) => {
  const model = `models/${env.GEMINI_EMBEDDING_MODEL}`;
  const json = await callGemini(`${model}:embedContent`, {
    model,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: env.GEMINI_EMBEDDING_DIM,
  });
  const values = json.embedding?.values ?? json.embedding?.value ?? [];
  return fitDimensions(values, env.GEMINI_EMBEDDING_DIM);
};

/** Embed texts, batched when the model allows it. Order matches the input. */
export const embedTexts = async (texts, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) => {
  if (!texts.length) return [];

  const model = `models/${env.GEMINI_EMBEDDING_MODEL}`;

  if (!serialEmbedMode && texts.length > 1) {
    try {
      const json = await callGemini(`${model}:batchEmbedContents`, {
        requests: texts.map((text) => ({
          model,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: env.GEMINI_EMBEDDING_DIM,
        })),
      });

      const embeddings = json.embeddings ?? [];
      if (embeddings.length !== texts.length) {
        throw new GeminiError(`Expected ${texts.length} embeddings, got ${embeddings.length}`);
      }
      return embeddings.map((e) =>
        fitDimensions(e.values ?? e.value ?? [], env.GEMINI_EMBEDDING_DIM)
      );
    } catch (err) {
      if (err.status !== 400) throw err;
      serialEmbedMode = true;
      logger.warn(
        { model: env.GEMINI_EMBEDDING_MODEL, err: err.message },
        'model rejected batch embedding - switching to serial requests'
      );
    }
  }

  const out = [];
  for (const text of texts) out.push(await embedOne(text, taskType));
  return out;
};

/**
 * Structured generation. responseSchema + responseMimeType make Gemini return
 * parseable JSON, which removes the "model wrapped it in markdown" failure mode.
 */
export const generateStructured = async ({
  systemInstruction,
  prompt,
  responseSchema,
  temperature = 0.2,
}) => {
  const model = `models/${env.GEMINI_CHAT_MODEL}`;
  const json = await callGemini(`${model}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
    },
  });

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join('') ?? '';

  if (!text) {
    throw new GeminiError(
      `Empty completion (finishReason: ${candidate?.finishReason ?? 'unknown'})`,
      { body: JSON.stringify(json).slice(0, 400) }
    );
  }

  return { text, model: env.GEMINI_CHAT_MODEL, usage: json.usageMetadata ?? null };
};

/** Strip ```json fences if a model ignores responseMimeType, then parse. */
export const parseJsonLoose = (text) => {
  const trimmed = String(text).trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw new GeminiError('Model did not return valid JSON');
  }
};

export { GeminiError, callGemini };
