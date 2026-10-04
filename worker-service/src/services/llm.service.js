import { llmMatchAnalysisSchema } from '@arm/shared/events';
import { generateStructured, parseJsonLoose } from '../utils/gemini.js';
import { logger } from '../utils/logger.js';

/**
 * JSON Schema handed to Gemini's responseSchema. It mirrors
 * llmMatchAnalysisSchema in the shared package; zod then re-validates the
 * reply, because "the model was asked nicely" is not a guarantee.
 */
export const MATCH_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER', description: 'Overall fit from 0 to 100' },
    summary: { type: 'STRING', description: 'Two or three sentences on the overall fit' },
    matchedSkills: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          evidence: { type: 'STRING', description: 'Quote or paraphrase from the resume' },
          confidence: { type: 'NUMBER', description: '0 to 1' },
        },
        required: ['name', 'evidence', 'confidence'],
      },
    },
    missingSkills: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          importance: { type: 'STRING', enum: ['critical', 'important', 'nice_to_have'] },
          reason: { type: 'STRING' },
        },
        required: ['name', 'importance', 'reason'],
      },
    },
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          detail: { type: 'STRING' },
          priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'detail', 'priority'],
      },
    },
  },
  required: ['score', 'summary', 'matchedSkills', 'missingSkills', 'suggestions'],
};

const SYSTEM_INSTRUCTION = `You are a precise technical recruiter assessing how well a candidate's resume matches a job description.

Rules you must follow:
- Judge ONLY on the resume excerpts provided. If an excerpt does not support a skill, it is missing, not matched.
- Never invent experience, employers, dates or numbers.
- "matched" means the resume shows concrete evidence of the skill; quote the evidence.
- Weight the requirements the job description calls out as required far above the nice-to-haves.
- Suggestions must be actionable rewrites or gaps to close, not generic career advice.
- Be calibrated: a strong but imperfect fit is 70-85, not 95. Reserve 90+ for a near-exact match.`;

export const buildMatchPrompt = ({ jobDescription, resumeContext, resumeSummaryChunks = [] }) => {
  const evidence = resumeContext
    .map(
      (chunk, i) =>
        `[Excerpt ${i + 1} | retrieval similarity ${Number(chunk.similarity).toFixed(3)}]\n${chunk.content}`
    )
    .join('\n\n');

  const opening = resumeSummaryChunks.length
    ? `RESUME OPENING (for context on seniority and headline):\n${resumeSummaryChunks.join('\n\n')}\n\n`
    : '';

  return `JOB DESCRIPTION:
"""
${jobDescription}
"""

${opening}RESUME EXCERPTS RETRIEVED AS MOST RELEVANT TO THIS JOB DESCRIPTION:
"""
${evidence}
"""

Analyse the fit and return JSON matching the required schema. Include at most 12 matched skills, 10 missing skills and 5 suggestions, ordered by importance.`;
};

/** Call the model and validate the reply against the shared zod schema. */
export const scoreMatch = async ({ jobDescription, resumeContext, resumeSummaryChunks }) => {
  const prompt = buildMatchPrompt({ jobDescription, resumeContext, resumeSummaryChunks });
  const startedAt = Date.now();

  const { text, model, usage } = await generateStructured({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    responseSchema: MATCH_RESPONSE_SCHEMA,
  });

  const parsed = llmMatchAnalysisSchema.parse(parseJsonLoose(text));
  const latencyMs = Date.now() - startedAt;

  logger.info({ model, latencyMs, score: parsed.score, usage }, 'llm scoring complete');

  return { ...parsed, score: Math.max(0, Math.min(100, parsed.score)), model, latencyMs };
};
