import path from 'node:path';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { TOPICS, buildResumeUploadedEvent } from '@arm/shared/events';
import { MATCH_STATUS, TERMINAL_MATCH_STATUSES } from '@arm/shared/constants';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { withTransaction, query } from '../db/index.js';
import { ResumeModel } from '../models/resume.model.js';
import { JobDescriptionModel } from '../models/jobDescription.model.js';
import { MatchResultModel } from '../models/matchResult.model.js';
import { uploadFileToS3, removeLocalFile } from '../utils/s3.js';
import { sha256File, contentHash } from '../utils/hash.js';
import { publishEvent } from '../kafka/index.js';
import { wakeWorker } from '../utils/wakeWorker.js';
import { logger } from '../utils/logger.js';
import {
  s3ResumeKey,
  MIN_JD_LENGTH,
  MAX_JD_LENGTH,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../constants.js';

const createMatchSchema = z.object({
  jobDescription: z
    .string()
    .min(MIN_JD_LENGTH, `Job description must be at least ${MIN_JD_LENGTH} characters`)
    .max(MAX_JD_LENGTH, `Job description must be under ${MAX_JD_LENGTH} characters`),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/**
 * POST /api/v1/matches      (multipart/form-data)
 *   fields: resume=<file>, jobDescription=<text>, title?, company?
 *
 * Writes the request down, hands the slow work to Kafka and returns 202 with a
 * poll URL. Nothing here calls Gemini - the request never blocks on an LLM.
 */
export const createMatch = asyncHandler(async (req, res) => {
  const { jobDescription, title, company } = createMatchSchema.parse(req.body);

  if (!req.file) throw ApiError.badRequest('Resume file is required (field name: "resume")');

  const { tenantId } = req;
  const userId = req.user.id;
  const tempPath = req.file.path;

  try {
    const fileHash = await sha256File(tempPath);

    // Identical file already uploaded by this user? Reuse it: no second S3 PUT,
    // and the worker will hit the Redis embedding cache instead of Gemini.
    let resume = await ResumeModel.findByContentHash({ tenantId, userId, contentHash: fileHash });
    let reusedResume = Boolean(resume);

    if (!resume) {
      const resumeId = uuid();
      const key = s3ResumeKey({
        tenantId,
        resumeId,
        extension: path.extname(req.file.originalname).toLowerCase(),
      });

      await uploadFileToS3({
        filePath: tempPath,
        key,
        contentType: req.file.mimetype,
        metadata: { tenantid: tenantId, userid: userId },
      });

      resume = await ResumeModel.create({
        id: resumeId,
        tenantId,
        userId,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        s3Key: key,
        contentHash: fileHash,
      });
    }

    const jdHash = contentHash(jobDescription);

    const { jd, match } = await withTransaction(async (client) => {
      const jdRow = await JobDescriptionModel.create(
        { tenantId, userId, title, company, rawText: jobDescription, contentHash: jdHash },
        client
      );
      const matchRow = await MatchResultModel.create(
        { tenantId, userId, resumeId: resume.id, jobDescriptionId: jdRow.id },
        client
      );
      await MatchResultModel.addEvent(
        {
          tenantId,
          matchId: matchRow.id,
          stage: 'queued',
          message: 'Match request accepted',
          metadata: { reusedResume, requestId: req.id },
        },
        client
      );
      return { jd: jdRow, match: matchRow };
    });

    const event = buildResumeUploadedEvent({
      eventId: uuid(),
      tenantId,
      userId,
      matchId: match.id,
      resume: {
        id: resume.id,
        s3Key: resume.s3_key,
        mimeType: resume.mime_type,
        originalFilename: resume.original_filename,
        contentHash: resume.content_hash,
      },
      jobDescription: { id: jd.id, contentHash: jd.content_hash },
    });

    try {
      await publishEvent({
        topic: TOPICS.RESUME_UPLOADED,
        key: match.id,
        event,
        headers: { 'x-request-id': String(req.id ?? '') },
      });
    } catch (err) {
      // The row exists but nobody will ever pick it up - say so honestly
      // instead of leaving the user polling a job that will never run.
      await query('UPDATE match_results SET status = $2, error = $3 WHERE id = $1', [
        match.id,
        MATCH_STATUS.FAILED,
        `Could not queue job: ${err.message}`,
      ]);
      logger.error({ err, matchId: match.id }, 'kafka publish failed');
      throw new ApiError(503, 'Job queue is unavailable, please retry shortly');
    }

    // The event is safely in Kafka now; nudge the worker in case it is asleep.
    wakeWorker();

    return res.status(202).json(
      new ApiResponse(
        202,
        {
          matchId: match.id,
          status: match.status,
          resumeId: resume.id,
          jobDescriptionId: jd.id,
          reusedResume,
          statusUrl: `/api/v1/matches/${match.id}/status`,
          resultUrl: `/api/v1/matches/${match.id}`,
        },
        'Match queued for analysis'
      )
    );
  } finally {
    removeLocalFile(tempPath);
  }
});

/**
 * GET /api/v1/matches/:id/status
 * Cheap endpoint built for polling: one indexed row plus its event timeline.
 */
export const getMatchStatus = asyncHandler(async (req, res) => {
  const { tenantId } = req;
  const status = await MatchResultModel.findStatusById({ id: req.params.id, tenantId });
  if (!status) throw ApiError.notFound('Match not found');

  const timeline = await MatchResultModel.listEvents({ tenantId, matchId: status.id });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        matchId: status.id,
        status: status.status,
        isTerminal: TERMINAL_MATCH_STATUSES.includes(status.status),
        attempts: status.attempts,
        error: status.error,
        createdAt: status.created_at,
        updatedAt: status.updated_at,
        timeline,
      },
      'Match status'
    )
  );
});

/** GET /api/v1/matches/:id - the full analysis. */
export const getMatchResult = asyncHandler(async (req, res) => {
  const match = await MatchResultModel.findById({ id: req.params.id, tenantId: req.tenantId });
  if (!match) throw ApiError.notFound('Match not found');

  if (match.status !== MATCH_STATUS.COMPLETED) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          matchId: match.id,
          status: match.status,
          error: match.error,
          ready: false,
        },
        'Match is not ready yet'
      )
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        matchId: match.id,
        status: match.status,
        ready: true,
        score: match.score === null ? null : Number(match.score),
        summary: match.summary,
        matchedSkills: match.matched_skills,
        missingSkills: match.missing_skills,
        suggestions: match.suggestions,
        model: match.model,
        latencyMs: match.latency_ms,
        resume: { id: match.resume_id, filename: match.resume_filename },
        job: { id: match.job_description_id, title: match.job_title, company: match.job_company },
        createdAt: match.created_at,
        completedAt: match.updated_at,
      },
      'Match result'
    )
  );
});

/** GET /api/v1/matches?page=1&limit=20 */
export const listMatches = asyncHandler(async (req, res) => {
  const { page, limit } = listQuerySchema.parse(req.query);
  const { items, total } = await MatchResultModel.listByUser({
    tenantId: req.tenantId,
    userId: req.user.id,
    limit,
    offset: (page - 1) * limit,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, { items, page, limit, total, hasMore: page * limit < total }, 'Matches')
    );
});
