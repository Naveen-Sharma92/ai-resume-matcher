import { jest } from '@jest/globals';
import request from 'supertest';

/**
 * API tests for the two endpoints that matter most: POST /matches (upload)
 * and GET /matches/:id (result).
 *
 * Postgres, Kafka, S3 and Redis are mocked at the module boundary, so these
 * run in CI with no infrastructure while still exercising the real router,
 * multer pipeline, auth middleware, validation and error envelope.
 */

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const RESUME_ID = '33333333-3333-4333-8333-333333333333';
const JD_ID = '44444444-4444-4444-8444-444444444444';
const MATCH_ID = '55555555-5555-4555-8555-555555555555';
const HASH = 'a'.repeat(64);

const user = {
  id: USER_ID,
  tenant_id: TENANT_ID,
  email: 'dev@example.com',
  full_name: 'Dev User',
  role: 'owner',
};

const resumeRow = {
  id: RESUME_ID,
  tenant_id: TENANT_ID,
  user_id: USER_ID,
  original_filename: 'resume.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  s3_key: `tenants/${TENANT_ID}/resumes/${RESUME_ID}.pdf`,
  content_hash: HASH,
};

const jdRow = { id: JD_ID, tenant_id: TENANT_ID, content_hash: HASH, raw_text: 'jd' };
const matchRow = { id: MATCH_ID, tenant_id: TENANT_ID, status: 'queued', attempts: 0 };

const dbQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const publishEvent = jest.fn().mockResolvedValue(undefined);
const uploadFileToS3 = jest
  .fn()
  .mockResolvedValue({ bucket: 'test-bucket', key: resumeRow.s3_key });

const ResumeModel = {
  findByContentHash: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue(resumeRow),
  findById: jest.fn().mockResolvedValue(resumeRow),
  listByUser: jest.fn().mockResolvedValue([]),
};

const JobDescriptionModel = {
  create: jest.fn().mockResolvedValue(jdRow),
  findById: jest.fn().mockResolvedValue(jdRow),
};

const MatchResultModel = {
  create: jest.fn().mockResolvedValue(matchRow),
  addEvent: jest.fn().mockResolvedValue(undefined),
  findById: jest.fn(),
  findStatusById: jest.fn(),
  listEvents: jest.fn().mockResolvedValue([]),
  listByUser: jest.fn().mockResolvedValue({ items: [], total: 0 }),
};

jest.unstable_mockModule('../../src/db/index.js', () => ({
  query: dbQuery,
  withTransaction: async (fn) => fn({ query: dbQuery }),
  getPool: jest.fn(),
  closeDB: jest.fn(),
  default: jest.fn(),
}));

jest.unstable_mockModule('../../src/kafka/index.js', () => ({
  publishEvent,
  connectKafka: jest.fn(),
  disconnectKafka: jest.fn(),
  ensureTopics: jest.fn(),
  getProducer: jest.fn(),
  kafka: {},
}));

jest.unstable_mockModule('../../src/utils/s3.js', () => ({
  uploadFileToS3,
  getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/resume.pdf'),
  deleteFromS3: jest.fn(),
  removeLocalFile: jest.fn(),
  s3: {},
}));

// Rate limiter: a pipeline that always reports "first request in the window".
jest.unstable_mockModule('../../src/utils/redis.js', () => {
  const pipeline = () => ({
    incr: function incr() {
      return this;
    },
    expire: function expire() {
      return this;
    },
    exec: async () => [[null, 1]],
  });
  const client = { pipeline, ping: async () => 'PONG' };
  return { getRedis: () => client, closeRedis: jest.fn(), default: () => client };
});

jest.unstable_mockModule('../../src/models/user.model.js', () => ({
  UserModel: { findById: jest.fn().mockResolvedValue(user) },
  default: { findById: jest.fn().mockResolvedValue(user) },
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

const { app } = await import('../../src/app.js');
const { generateAccessToken } = await import('../../src/utils/tokens.js');
const { resumeUploadedSchema, TOPICS } = await import('@arm/shared/events');

const authHeader = () => `Bearer ${generateAccessToken(user)}`;
const pdfBuffer = Buffer.from('%PDF-1.4 fake resume for tests');
const JD_TEXT =
  'We are hiring a Backend SDE-1 with Node.js, Express, Kafka, Postgres and Docker experience. ' +
  'You will build and operate microservices in production.';

beforeEach(() => {
  jest.clearAllMocks();
  ResumeModel.findByContentHash.mockResolvedValue(null);
  ResumeModel.create.mockResolvedValue(resumeRow);
  JobDescriptionModel.create.mockResolvedValue(jdRow);
  MatchResultModel.create.mockResolvedValue(matchRow);
  publishEvent.mockResolvedValue(undefined);
});

describe('GET /healthz', () => {
  it('answers without touching any dependency', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/v1/matches', () => {
  it('rejects an unauthenticated upload', async () => {
    const res = await request(app)
      .post('/api/v1/matches')
      .field('jobDescription', JD_TEXT)
      .attach('resume', pdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('accepts a PDF, stores it and publishes a valid resume.uploaded event', async () => {
    const res = await request(app)
      .post('/api/v1/matches')
      .set('Authorization', authHeader())
      .field('jobDescription', JD_TEXT)
      .field('title', 'Backend SDE-1')
      .attach('resume', pdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(202);
    expect(res.body.data.matchId).toBe(MATCH_ID);
    expect(res.body.data.statusUrl).toBe(`/api/v1/matches/${MATCH_ID}/status`);

    expect(uploadFileToS3).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);

    const published = publishEvent.mock.calls[0][0];
    expect(published.topic).toBe(TOPICS.RESUME_UPLOADED);
    expect(published.key).toBe(MATCH_ID);
    // The event must satisfy the contract the worker validates against.
    expect(() => resumeUploadedSchema.parse(published.event)).not.toThrow();
  });

  it('reuses an identical resume instead of uploading it again', async () => {
    ResumeModel.findByContentHash.mockResolvedValue(resumeRow);

    const res = await request(app)
      .post('/api/v1/matches')
      .set('Authorization', authHeader())
      .field('jobDescription', JD_TEXT)
      .attach('resume', pdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(202);
    expect(res.body.data.reusedResume).toBe(true);
    expect(uploadFileToS3).not.toHaveBeenCalled();
    expect(ResumeModel.create).not.toHaveBeenCalled();
  });

  it('rejects a job description that is too short', async () => {
    const res = await request(app)
      .post('/api/v1/matches')
      .set('Authorization', authHeader())
      .field('jobDescription', 'too short')
      .attach('resume', pdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type', async () => {
    const res = await request(app)
      .post('/api/v1/matches')
      .set('Authorization', authHeader())
      .field('jobDescription', JD_TEXT)
      .attach('resume', Buffer.from('plain text'), {
        filename: 'resume.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/PDF and DOCX/);
  });

  it('marks the match failed and returns 503 when Kafka is unreachable', async () => {
    publishEvent.mockRejectedValue(new Error('broker down'));

    const res = await request(app)
      .post('/api/v1/matches')
      .set('Authorization', authHeader())
      .field('jobDescription', JD_TEXT)
      .attach('resume', pdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(503);
    // The row must not be left sitting in `queued` with nobody to consume it.
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE match_results'), [
      MATCH_ID,
      'failed',
      expect.stringContaining('broker down'),
    ]);
  });
});

describe('GET /api/v1/matches/:id', () => {
  it('returns the full analysis once the worker has finished', async () => {
    MatchResultModel.findById.mockResolvedValue({
      ...matchRow,
      status: 'completed',
      score: '82.50',
      summary: 'Strong backend fit.',
      matched_skills: [{ name: 'Kafka', evidence: 'Built an event pipeline', confidence: 0.9 }],
      missing_skills: [{ name: 'Kubernetes', importance: 'important', reason: 'Not mentioned' }],
      suggestions: [{ title: 'Quantify impact', detail: 'Add numbers', priority: 'high' }],
      model: 'gemini-3.8-flash',
      latency_ms: 4200,
      resume_id: RESUME_ID,
      job_description_id: JD_ID,
      resume_filename: 'resume.pdf',
      job_title: 'Backend SDE-1',
      job_company: 'Acme',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const res = await request(app)
      .get(`/api/v1/matches/${MATCH_ID}`)
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.ready).toBe(true);
    expect(res.body.data.score).toBe(82.5); // numeric, not the string Postgres returns
    expect(res.body.data.matchedSkills[0].name).toBe('Kafka');
    expect(res.body.data.job.company).toBe('Acme');
  });

  it('reports not-ready while the job is still queued', async () => {
    MatchResultModel.findById.mockResolvedValue({ ...matchRow, status: 'processing', error: null });

    const res = await request(app)
      .get(`/api/v1/matches/${MATCH_ID}`)
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.ready).toBe(false);
    expect(res.body.data.status).toBe('processing');
  });

  it('404s for an id that belongs to another tenant', async () => {
    MatchResultModel.findById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/matches/${MATCH_ID}`)
      .set('Authorization', authHeader());

    expect(res.status).toBe(404);
    // The tenant from the JWT is what scopes the lookup - never a body field.
    expect(MatchResultModel.findById).toHaveBeenCalledWith({ id: MATCH_ID, tenantId: TENANT_ID });
  });
});

describe('GET /api/v1/matches/:id/status', () => {
  it('returns the stage timeline and a terminal flag for polling', async () => {
    MatchResultModel.findStatusById.mockResolvedValue({
      id: MATCH_ID,
      status: 'completed',
      attempts: 1,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    MatchResultModel.listEvents.mockResolvedValue([
      {
        stage: 'queued',
        message: 'Match request accepted',
        metadata: {},
        created_at: new Date().toISOString(),
      },
      {
        stage: 'completed',
        message: 'Analysis complete',
        metadata: { score: 82.5 },
        created_at: new Date().toISOString(),
      },
    ]);

    const res = await request(app)
      .get(`/api/v1/matches/${MATCH_ID}/status`)
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.isTerminal).toBe(true);
    expect(res.body.data.timeline).toHaveLength(2);
  });
});
