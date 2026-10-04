import { CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS } from '@arm/shared/constants';
import { sha256 } from './hash.js';

/** Collapse the whitespace soup that PDF extraction produces. */
export const cleanText = (raw) =>
  String(raw ?? '')
    .replace(/\r\n/g, '\n')
    // Drop stray control characters (form feeds from PDFs) but keep newlines.
    .replace(/\p{Cc}/gu, (ch) => (ch === '\n' ? ch : ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Paragraph-aware sliding-window chunker.
 *
 * Splitting on blank lines first keeps a bullet list or a job entry intact,
 * which matters for retrieval quality: a chunk that starts mid-sentence embeds
 * badly. The character overlap stops a skill that straddles a boundary from
 * disappearing from both chunks.
 */
export const chunkText = (
  text,
  { size = CHUNK_SIZE_CHARS, overlap = CHUNK_OVERLAP_CHARS } = {}
) => {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  if (cleaned.length <= size) return [cleaned];

  const paragraphs = cleaned.split(/\n\s*\n/);
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      pushCurrent();
      current = '';
      for (let start = 0; start < paragraph.length; start += size - overlap) {
        chunks.push(paragraph.slice(start, start + size).trim());
        if (start + size >= paragraph.length) break;
      }
      continue;
    }

    if ((current + '\n\n' + paragraph).trim().length > size) {
      pushCurrent();
      const tail = current.slice(-overlap);
      current = tail + '\n\n' + paragraph;
    } else {
      current = current ? current + '\n\n' + paragraph : paragraph;
    }
  }
  pushCurrent();

  return chunks.filter(Boolean);
};

/** Chunk + annotate with index and content hash (the Redis cache key). */
export const buildChunks = (text, options) =>
  chunkText(text, options).map((content, index) => ({
    index,
    content,
    contentHash: sha256(content),
  }));
