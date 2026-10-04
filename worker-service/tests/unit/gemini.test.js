import { fitDimensions, parseJsonLoose, GeminiError } from '../../src/utils/gemini.js';

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
