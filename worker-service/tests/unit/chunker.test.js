import { chunkText, buildChunks, cleanText } from '../../src/utils/chunker.js';

describe('cleanText', () => {
  it('normalises line endings and collapses runs of blank lines', () => {
    expect(cleanText('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
  });

  it('strips control characters that PDF extraction leaves behind', () => {
    const withFormFeed = `SkillsNode.js`;
    expect(cleanText(withFormFeed)).toBe('Skills Node.js');
  });

  it('tolerates null and undefined', () => {
    expect(cleanText(null)).toBe('');
    expect(cleanText(undefined)).toBe('');
  });
});

describe('chunkText', () => {
  it('returns a single chunk when the text fits', () => {
    expect(chunkText('short resume')).toEqual(['short resume']);
  });

  it('returns nothing for empty input', () => {
    expect(chunkText('   ')).toEqual([]);
  });

  it('keeps every chunk within the size limit', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`);
    const chunks = chunkText(paragraphs.join('\n\n'), { size: 500, overlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
  });

  it('hard-splits a single oversized paragraph', () => {
    const chunks = chunkText('x'.repeat(2500), { size: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
  });

  it('overlaps consecutive chunks so a skill on a boundary is not lost', () => {
    const text = `${'a'.repeat(400)}\n\n${'b'.repeat(400)}\n\n${'c'.repeat(400)}`;
    const chunks = chunkText(text, { size: 500, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    // The tail of one chunk reappears at the head of the next.
    const tail = chunks[0].slice(-40);
    expect(chunks[1]).toContain(tail.slice(0, 20));
  });
});

describe('buildChunks', () => {
  it('annotates chunks with a stable index and content hash', () => {
    const chunks = buildChunks('Backend engineer with Kafka experience');
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].contentHash).toHaveLength(64);
    // Same input, same hash: this is what makes the Redis embedding cache work.
    expect(buildChunks('Backend engineer with Kafka experience')[0].contentHash).toBe(
      chunks[0].contentHash
    );
  });
});
