import crypto from 'node:crypto';
import fs from 'node:fs';

/** sha256 of a string - used as the cache key for JD text. */
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** sha256 of a file on disk, streamed so a 5 MB PDF never sits in memory twice. */
export const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });

/** Normalise text before hashing so trivial whitespace edits still hit the cache. */
export const normalizeText = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

export const contentHash = (text) => sha256(normalizeText(text));
