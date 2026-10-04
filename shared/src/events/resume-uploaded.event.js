import { z } from 'zod';
import { TOPICS } from './topics.js';

/**
 * `resume.uploaded`
 * Published by api-service after the file is stored in S3 and the
 * match_results row exists in `queued` state. Consumed by worker-service.
 *
 * Kafka message key = matchId, so every event for one match lands on the same
 * partition and is processed in order.
 */
export const resumeUploadedSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal(TOPICS.RESUME_UPLOADED),
  eventVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  matchId: z.string().uuid(),
  resume: z.object({
    id: z.string().uuid(),
    s3Key: z.string().min(1),
    mimeType: z.string().min(1),
    originalFilename: z.string().min(1),
    contentHash: z.string().length(64),
  }),
  jobDescription: z.object({
    id: z.string().uuid(),
    contentHash: z.string().length(64),
  }),
});

/** @typedef {z.infer<typeof resumeUploadedSchema>} ResumeUploadedEvent */

export function buildResumeUploadedEvent(payload) {
  return resumeUploadedSchema.parse({
    eventType: TOPICS.RESUME_UPLOADED,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    ...payload,
  });
}
