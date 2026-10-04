import { centroid, cosineSimilarity } from '../../src/services/embedding.service.js';

describe('centroid', () => {
  it('averages the vectors and returns a unit vector', () => {
    const result = centroid([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const norm = Math.sqrt(result.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(result[0]).toBeCloseTo(result[1], 6);
    expect(result[2]).toBeCloseTo(0, 6);
  });

  it('refuses an empty set', () => {
    expect(() => centroid([])).toThrow();
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical direction and 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('is negative for opposing vectors', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
  });
});
