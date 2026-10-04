import { z } from 'zod';
import { TOPICS } from './topics.js';
import { MATCH_STATUS } from '../constants.js';

export const skillSchema = z.object({
  name: z.string().min(1),
  evidence: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const missingSkillSchema = z.object({
  name: z.string().min(1),
  importance: z.enum(['critical', 'important', 'nice_to_have']).default('important'),
  reason: z.string().default(''),
});

export const suggestionSchema = z.object({
  title: z.string().min(1),
  detail: z.string().default(''),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
});

/**
 * `match.completed`
 * Published by worker-service once the LLM scoring finished (or failed).
 * api-service does not strictly need to consume this (it reads Postgres), but
 * publishing it keeps the pipeline event-driven and lets you bolt on
 * notifications/analytics consumers later without touching the worker.
 */
export const matchCompletedSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal(TOPICS.MATCH_COMPLETED),
  eventVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  matchId: z.string().uuid(),
  status: z.enum([MATCH_STATUS.COMPLETED, MATCH_STATUS.FAILED]),
  score: z.number().min(0).max(100).nullable().default(null),
  matchedSkills: z.array(skillSchema).default([]),
  missingSkills: z.array(missingSkillSchema).default([]),
  suggestions: z.array(suggestionSchema).default([]),
  summary: z.string().default(''),
  model: z.string().default(''),
  latencyMs: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
});

/** @typedef {z.infer<typeof matchCompletedSchema>} MatchCompletedEvent */

export function buildMatchCompletedEvent(payload) {
  return matchCompletedSchema.parse({
    eventType: TOPICS.MATCH_COMPLETED,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    ...payload,
  });
}

/** Shape the LLM must return. Reused as the Gemini responseSchema source of truth. */
export const llmMatchAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  matchedSkills: z.array(skillSchema),
  missingSkills: z.array(missingSkillSchema),
  suggestions: z.array(suggestionSchema),
});
