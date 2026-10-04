import { buildMatchPrompt, MATCH_RESPONSE_SCHEMA } from '../../src/services/llm.service.js';
import { llmMatchAnalysisSchema } from '@arm/shared/events';

describe('buildMatchPrompt', () => {
  const context = [
    { content: 'Built a Kafka pipeline processing 2M events/day', similarity: 0.8123 },
    { content: 'Wrote Express REST APIs with Postgres', similarity: 0.7412 },
  ];

  it('includes the job description and every retrieved excerpt', () => {
    const prompt = buildMatchPrompt({
      jobDescription: 'Backend SDE-1 with Kafka',
      resumeContext: context,
    });
    expect(prompt).toContain('Backend SDE-1 with Kafka');
    expect(prompt).toContain('Kafka pipeline');
    expect(prompt).toContain('Express REST APIs');
  });

  it('labels each excerpt with its retrieval similarity', () => {
    const prompt = buildMatchPrompt({ jobDescription: 'jd', resumeContext: context });
    expect(prompt).toContain('Excerpt 1 | retrieval similarity 0.812');
    expect(prompt).toContain('Excerpt 2 | retrieval similarity 0.741');
  });

  it('omits the opening section when no summary chunks are given', () => {
    expect(buildMatchPrompt({ jobDescription: 'jd', resumeContext: context })).not.toContain(
      'RESUME OPENING'
    );
  });
});

describe('response contract', () => {
  it('declares every field the shared zod schema requires', () => {
    expect(MATCH_RESPONSE_SCHEMA.required).toEqual(
      expect.arrayContaining(['score', 'summary', 'matchedSkills', 'missingSkills', 'suggestions'])
    );
  });

  it('accepts a well-formed model response', () => {
    const parsed = llmMatchAnalysisSchema.parse({
      score: 78,
      summary: 'Good fit',
      matchedSkills: [{ name: 'Kafka', evidence: 'built a pipeline', confidence: 0.9 }],
      missingSkills: [{ name: 'k8s', importance: 'critical', reason: 'not mentioned' }],
      suggestions: [{ title: 'Add metrics', detail: 'quantify impact', priority: 'high' }],
    });
    expect(parsed.score).toBe(78);
  });

  it('rejects a score outside 0-100', () => {
    expect(() =>
      llmMatchAnalysisSchema.parse({
        score: 140,
        summary: '',
        matchedSkills: [],
        missingSkills: [],
        suggestions: [],
      })
    ).toThrow();
  });
});
