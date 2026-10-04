import { jest } from '@jest/globals';

/**
 * End-to-end test of the worker pipeline with every external dependency mocked:
 * proves the orchestration order, that a cached parse skips S3, and that a
 * permanent failure is not retried.
 */

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const RESUME_ID = '33333333-3333-4333-8333-333333333333';
const JD_ID = '44444444-4444-4444-8444-444444444444';
const MATCH_ID = '55555555-5555-4555-8555-555555555555';
const HASH = 'b'.repeat(64);

const vector = (seed) => Array.from({ length: 768 }, (_, i) => Math.sin(seed + i) / 10);

const event = {
  eventId: '66666666-6666-4666-8666-666666666666',
  eventType: 'resume.uploaded',
  eventVersion: 1,
  occurredAt: new Date().toISOString(),
  tenantId: TENANT_ID,
  userId: USER_ID,
  matchId: MATCH_ID,
  resume: {
    id: RESUME_ID,
    s3Key: 'tenants/x/resumes/y.pdf',
    mimeType: 'application/pdf',
    originalFilename: 'resume.pdf',
    contentHash: HASH,
  },
  jobDescription: { id: JD_ID, contentHash: HASH },
};

const ResumeModel = {
  findById: jest.fn(),
  saveParsedText: jest.fn().mockResolvedValue({ id: RESUME_ID }),
  findParsedTextByHash: jest.fn().mockResolvedValue(null),
};

const JobDescriptionModel = {
  findById: jest.fn().mockResolvedValue({
    id: JD_ID,
    raw_text: 'We need a backend engineer with Kafka, Postgres and Docker experience.',
  }),
};

const MatchResultModel = {
  markProcessing: jest.fn().mockResolvedValue({ id: MATCH_ID, attempts: 1 }),
  addEvent: jest.fn().mockResolvedValue(undefined),
  saveResult: jest.fn().mockResolvedValue({ id: MATCH_ID }),
  markFailed: jest.fn().mockResolvedValue({ id: MATCH_ID, attempts: 3 }),
  findStatusById: jest.fn().mockResolvedValue({ id: MATCH_ID, attempts: 1, status: 'processing' }),
};

const EmbeddingModel = {
  countForOwner: jest.fn().mockResolvedValue(0),
  insertMany: jest.fn().mockResolvedValue(2),
  searchSimilarChunks: jest.fn().mockResolvedValue([
    { chunk_index: 0, content: 'Built a Kafka pipeline', similarity: 0.82 },
    { chunk_index: 1, content: 'Express + Postgres APIs', similarity: 0.74 },
  ]),
};

const downloadFromS3 = jest.fn().mockResolvedValue(Buffer.from('%PDF fake'));
const extractText = jest.fn().mockResolvedValue('Backend engineer. Built a Kafka pipeline.');
const publishEvent = jest.fn().mockResolvedValue(undefined);

const scoreMatch = jest.fn().mockResolvedValue({
  score: 81,
  summary: 'Strong backend fit.',
  matchedSkills: [{ name: 'Kafka', evidence: 'built a pipeline', confidence: 0.9 }],
  missingSkills: [{ name: 'Kubernetes', importance: 'important', reason: 'not mentioned' }],
  suggestions: [{ title: 'Quantify impact', detail: 'add numbers', priority: 'high' }],
  model: 'gemini-3.8-flash',
  latencyMs: 3200,
});

const embedChunks = jest.fn(async (chunks) => ({
  chunks: chunks.map((c, i) => ({ ...c, embedding: vector(i) })),
  cacheHits: 0,
  embedded: chunks.length,
}));

jest.unstable_mockModule('../../src/models/resume.model.js', () => ({
  ResumeModel,
  default: ResumeModel,
}));
jest.unstable_mockModule('../../src/models/jobDescription.model.js', () => ({
  JobDescriptionModel,
  default: JobDescriptionModel,
}));
jest.unstable_mockModule('../../src/models/matchResult.model.js', () => ({
  MatchResultModel,
  default: MatchResultModel,
}));
jest.unstable_mockModule('../../src/models/embedding.model.js', () => ({
  EmbeddingModel,
  default: EmbeddingModel,
  toVectorLiteral: (v) => `[${v.join(',')}]`,
}));
jest.unstable_mockModule('../../src/utils/s3.js', () => ({ downloadFromS3, s3: {} }));
jest.unstable_mockModule('../../src/services/textExtraction.service.js', () => ({
  extractText,
  default: extractText,
  UnsupportedFileError: class UnsupportedFileError extends Error {},
  EmptyResumeError: class EmptyResumeError extends Error {},
}));
jest.unstable_mockModule('../../src/services/embedding.service.js', () => ({
  embedChunks,
  centroid: (vectors) => vectors[0],
  cosineSimilarity: () => 1,
}));
jest.unstable_mockModule('../../src/services/llm.service.js', () => ({
  scoreMatch,
  buildMatchPrompt: jest.fn(),
  MATCH_RESPONSE_SCHEMA: {},
}));
jest.unstable_mockModule('../../src/kafka/index.js', () => ({
  publishEvent,
  getConsumer: jest.fn(),
  getProducer: jest.fn(),
  connectKafka: jest.fn(),
  disconnectKafka: jest.fn(),
  kafka: {},
}));

const { processMatchJob, handleJobFailure } =
  await import('../../src/controllers/match.controller.js');
const { TOPICS } = await import('@arm/shared/events');

beforeEach(() => {
  jest.clearAllMocks();
  ResumeModel.findById.mockResolvedValue({
    id: RESUME_ID,
    s3_key: 'tenants/x/resumes/y.pdf',
    mime_type: 'application/pdf',
    original_filename: 'resume.pdf',
    parsed_text: null,
  });
  ResumeModel.findParsedTextByHash.mockResolvedValue(null);
  MatchResultModel.markProcessing.mockResolvedValue({ id: MATCH_ID, attempts: 1 });
  MatchResultModel.findStatusById.mockResolvedValue({ id: MATCH_ID, attempts: 1 });
});

describe('processMatchJob', () => {
  it('runs download -> extract -> embed -> retrieve -> score -> persist -> publish', async () => {
    const result = await processMatchJob(event);

    expect(downloadFromS3).toHaveBeenCalledWith('tenants/x/resumes/y.pdf');
    expect(extractText).toHaveBeenCalled();
    expect(embedChunks).toHaveBeenCalledTimes(2); // resume + job description
    expect(EmbeddingModel.searchSimilarChunks).toHaveBeenCalled();
    expect(scoreMatch).toHaveBeenCalled();

    expect(MatchResultModel.saveResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: MATCH_ID, score: 81, model: 'gemini-3.8-flash' })
    );

    const published = publishEvent.mock.calls[0][0];
    expect(published.topic).toBe(TOPICS.MATCH_COMPLETED);
    expect(published.event.status).toBe('completed');
    expect(result.score).toBe(81);
  });

  it('passes the retrieved excerpts to the model, not the whole resume', async () => {
    await processMatchJob(event);
    const { resumeContext } = scoreMatch.mock.calls[0][0];
    expect(resumeContext.length).toBeGreaterThan(0);
    expect(resumeContext[0]).toHaveProperty('similarity');
  });

  it('skips S3 entirely when the text was already extracted', async () => {
    ResumeModel.findById.mockResolvedValue({
      id: RESUME_ID,
      s3_key: 'tenants/x/resumes/y.pdf',
      mime_type: 'application/pdf',
      original_filename: 'resume.pdf',
      parsed_text: 'Cached resume text with Kafka experience.',
    });

    await processMatchJob(event);

    expect(downloadFromS3).not.toHaveBeenCalled();
    expect(extractText).not.toHaveBeenCalled();
    expect(scoreMatch).toHaveBeenCalled();
  });

  it('drops the event when the match row is gone', async () => {
    MatchResultModel.markProcessing.mockResolvedValue(null);
    await expect(processMatchJob(event)).resolves.toEqual({ skipped: true });
    expect(scoreMatch).not.toHaveBeenCalled();
  });
});

describe('handleJobFailure', () => {
  it('asks for a retry while attempts remain', async () => {
    MatchResultModel.findStatusById.mockResolvedValue({ id: MATCH_ID, attempts: 1 });

    const outcome = await handleJobFailure({ event, error: new Error('gemini 429') });

    expect(outcome.retry).toBe(true);
    expect(MatchResultModel.markFailed).not.toHaveBeenCalled();
  });

  it('gives up once the attempt budget is spent and parks the event on the DLQ', async () => {
    MatchResultModel.findStatusById.mockResolvedValue({ id: MATCH_ID, attempts: 3 });

    const outcome = await handleJobFailure({ event, error: new Error('gemini down') });

    expect(outcome.retry).toBe(false);
    expect(MatchResultModel.markFailed).toHaveBeenCalled();
    const topics = publishEvent.mock.calls.map((c) => c[0].topic);
    expect(topics).toContain(TOPICS.MATCH_COMPLETED);
    expect(topics).toContain(TOPICS.MATCH_FAILED_DLQ);
  });

  it('never retries a permanent failure such as a scanned PDF', async () => {
    MatchResultModel.findStatusById.mockResolvedValue({ id: MATCH_ID, attempts: 1 });
    const err = new Error('Could not read any text from this resume.');
    err.name = 'EmptyResumeError';

    const outcome = await handleJobFailure({ event, error: err });

    expect(outcome.retry).toBe(false);
    expect(MatchResultModel.markFailed).toHaveBeenCalled();
  });
});
