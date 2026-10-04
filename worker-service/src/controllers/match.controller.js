import { v4 as uuid } from 'uuid';
import { TOPICS, buildMatchCompletedEvent } from '@arm/shared/events';
import { OWNER_TYPE, MATCH_STATUS } from '@arm/shared/constants';
import { STAGES } from '../constants.js';
import { env } from '../envConfig.js';
import { logger } from '../utils/logger.js';
import { downloadFromS3 } from '../utils/s3.js';
import { buildChunks } from '../utils/chunker.js';
import { contentHash } from '../utils/hash.js';
import { ResumeModel } from '../models/resume.model.js';
import { JobDescriptionModel } from '../models/jobDescription.model.js';
import { MatchResultModel } from '../models/matchResult.model.js';
import { EmbeddingModel } from '../models/embedding.model.js';
import { extractText } from '../services/textExtraction.service.js';
import { embedChunks } from '../services/embedding.service.js';
import { retrieveResumeContext, retrievalConfidence } from '../services/rag.service.js';
import { scoreMatch } from '../services/llm.service.js';
import { publishEvent } from '../kafka/index.js';
import { EMBED_TASK } from '../constants.js';

/** Errors that will never succeed on a retry - fail the job immediately. */
const isPermanent = (err) =>
  ['UnsupportedFileError', 'EmptyResumeError', 'NoSuchKey', 'ZodError'].includes(err.name) ||
  // Set by the Gemini client when the daily free-tier allowance is gone.
  err.permanent === true;

const stage = async ({ tenantId, matchId, name, message, metadata }) => {
  await MatchResultModel.addEvent({ tenantId, matchId, stage: name, message, metadata });
  logger.info({ matchId, stage: name, ...metadata }, message ?? name);
};

/**
 * The whole pipeline for one `resume.uploaded` event.
 *
 * Every step is idempotent: Kafka guarantees at-least-once delivery, so this
 * function must be safe to run twice for the same matchId. Parsed text and
 * embeddings are reused when they already exist, and the embeddings insert
 * uses ON CONFLICT DO NOTHING.
 */
export const processMatchJob = async (event) => {
  const { tenantId, userId, matchId } = event;
  const jobStartedAt = Date.now();

  const claimed = await MatchResultModel.markProcessing({ id: matchId, tenantId });
  if (!claimed) {
    logger.warn({ matchId }, 'match row not found - dropping event');
    return { skipped: true };
  }

  await stage({
    tenantId,
    matchId,
    name: STAGES.RECEIVED,
    message: 'Worker picked up the job',
    metadata: { attempt: claimed.attempts },
  });

  // ---------------------------------------------------------------- 1. resume text
  const resume = await ResumeModel.findById({ id: event.resume.id, tenantId });
  if (!resume) {
    const err = new Error('Resume row disappeared');
    err.permanent = true;
    throw err;
  }

  let resumeText = resume.parsed_text;

  if (!resumeText) {
    resumeText = await ResumeModel.findParsedTextByHash({
      tenantId,
      contentHash: event.resume.contentHash,
    });
  }

  if (!resumeText) {
    await stage({
      tenantId,
      matchId,
      name: STAGES.DOWNLOADING,
      message: 'Fetching resume from S3',
    });
    const buffer = await downloadFromS3(resume.s3_key);

    await stage({ tenantId, matchId, name: STAGES.EXTRACTING, message: 'Extracting text' });
    resumeText = await extractText({
      buffer,
      mimeType: resume.mime_type,
      filename: resume.original_filename,
    });
  }

  await ResumeModel.saveParsedText({ id: resume.id, tenantId, text: resumeText });

  // ---------------------------------------------------------------- 2. job description
  const jd = await JobDescriptionModel.findById({ id: event.jobDescription.id, tenantId });
  if (!jd) {
    const err = new Error('Job description row disappeared');
    err.permanent = true;
    throw err;
  }

  // ---------------------------------------------------------------- 3. embeddings (RAG index)
  await stage({
    tenantId,
    matchId,
    name: STAGES.EMBEDDING,
    message: 'Embedding resume and job description',
  });

  const resumeChunks = buildChunks(resumeText);
  const jdChunks = buildChunks(jd.raw_text);

  const alreadyIndexed = await EmbeddingModel.countForOwner({
    tenantId,
    ownerType: OWNER_TYPE.RESUME,
    ownerId: resume.id,
  });

  const { chunks: embeddedResumeChunks, cacheHits: resumeCacheHits } = await embedChunks(
    resumeChunks,
    { taskType: EMBED_TASK.DOCUMENT }
  );

  if (alreadyIndexed !== resumeChunks.length) {
    await EmbeddingModel.insertMany({
      tenantId,
      ownerType: OWNER_TYPE.RESUME,
      ownerId: resume.id,
      chunks: embeddedResumeChunks,
    });
  }

  const { chunks: embeddedJdChunks, cacheHits: jdCacheHits } = await embedChunks(jdChunks, {
    taskType: EMBED_TASK.QUERY,
  });

  await EmbeddingModel.insertMany({
    tenantId,
    ownerType: OWNER_TYPE.JOB_DESCRIPTION,
    ownerId: jd.id,
    chunks: embeddedJdChunks,
  });

  // ---------------------------------------------------------------- 4. retrieval
  await stage({
    tenantId,
    matchId,
    name: STAGES.RETRIEVING,
    message: 'Retrieving the most relevant resume sections',
    metadata: {
      resumeChunks: resumeChunks.length,
      jdChunks: jdChunks.length,
      resumeCacheHits,
      jdCacheHits,
    },
  });

  const { context } = await retrieveResumeContext({
    tenantId,
    resumeId: resume.id,
    jdChunks: embeddedJdChunks,
  });

  if (!context.length) {
    const err = new Error('No resume content could be retrieved for this job description');
    err.permanent = true;
    throw err;
  }

  // ---------------------------------------------------------------- 5. LLM scoring
  await stage({
    tenantId,
    matchId,
    name: STAGES.SCORING,
    message: 'Scoring the match with Gemini',
    metadata: { retrievalConfidence: Number(retrievalConfidence(context).toFixed(3)) },
  });

  const analysis = await scoreMatch({
    jobDescription: jd.raw_text,
    resumeContext: context,
    resumeSummaryChunks: resumeChunks.slice(0, 1).map((c) => c.content),
  });

  // ---------------------------------------------------------------- 6. persist + publish
  await MatchResultModel.saveResult({
    id: matchId,
    tenantId,
    score: analysis.score,
    summary: analysis.summary,
    matchedSkills: analysis.matchedSkills,
    missingSkills: analysis.missingSkills,
    suggestions: analysis.suggestions,
    model: analysis.model,
    latencyMs: analysis.latencyMs,
  });

  await stage({
    tenantId,
    matchId,
    name: STAGES.COMPLETED,
    message: 'Analysis complete',
    metadata: { score: analysis.score, totalMs: Date.now() - jobStartedAt },
  });

  await publishEvent({
    topic: TOPICS.MATCH_COMPLETED,
    key: matchId,
    event: buildMatchCompletedEvent({
      eventId: uuid(),
      tenantId,
      userId,
      matchId,
      status: MATCH_STATUS.COMPLETED,
      score: analysis.score,
      matchedSkills: analysis.matchedSkills,
      missingSkills: analysis.missingSkills,
      suggestions: analysis.suggestions,
      summary: analysis.summary,
      model: analysis.model,
      latencyMs: analysis.latencyMs,
      error: null,
    }),
  });

  return { matchId, score: analysis.score, totalMs: Date.now() - jobStartedAt };
};

/**
 * Failure path. Retries are worth it for a 429 from Gemini; they are pointless
 * for a scanned PDF. Once the attempt budget is gone the row is marked failed,
 * a match.completed(failed) event goes out so the UI stops spinning, and the
 * original event is parked on the DLQ topic for inspection.
 */
export const handleJobFailure = async ({ event, error, contextInfo = {} }) => {
  const { tenantId, userId, matchId } = event;
  const permanent = isPermanent(error);
  const current = await MatchResultModel.findStatusById({ id: matchId, tenantId });
  const attempts = current?.attempts ?? env.MAX_ATTEMPTS;
  const exhausted = permanent || attempts >= env.MAX_ATTEMPTS;

  logger.error(
    { err: error, matchId, attempts, permanent, exhausted, ...contextInfo },
    'match job failed'
  );

  if (!exhausted) {
    await MatchResultModel.addEvent({
      tenantId,
      matchId,
      stage: 'retry_scheduled',
      message: error.message,
      metadata: { attempts },
    });
    return { retry: true };
  }

  await MatchResultModel.markFailed({ id: matchId, tenantId, error: error.message });
  await MatchResultModel.addEvent({
    tenantId,
    matchId,
    stage: STAGES.FAILED,
    message: error.message,
    metadata: { attempts, permanent },
  });

  await publishEvent({
    topic: TOPICS.MATCH_COMPLETED,
    key: matchId,
    event: buildMatchCompletedEvent({
      eventId: uuid(),
      tenantId,
      userId,
      matchId,
      status: MATCH_STATUS.FAILED,
      error: error.message,
    }),
  }).catch((err) => logger.error({ err }, 'could not publish failure event'));

  await publishEvent({
    topic: TOPICS.MATCH_FAILED_DLQ,
    key: matchId,
    event: { ...event, failedAt: new Date().toISOString(), error: error.message, attempts },
  }).catch((err) => logger.error({ err }, 'could not publish to DLQ'));

  return { retry: false };
};
