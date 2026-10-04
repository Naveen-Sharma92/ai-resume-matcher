import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import { cleanText } from '../utils/chunker.js';
import { env } from '../envConfig.js';
import { logger } from '../utils/logger.js';

// pdf-parse is CommonJS and its index.js runs a demo block when imported
// directly, so require the library entry point instead.
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class UnsupportedFileError extends Error {}
export class EmptyResumeError extends Error {}

/**
 * Turn the raw resume bytes into plain text.
 *
 * Scanned/image-only PDFs come back empty - we fail the job with a message the
 * user can act on rather than sending an empty document to the LLM and
 * returning a confidently wrong score.
 */
export const extractText = async ({ buffer, mimeType, filename = '' }) => {
  const startedAt = Date.now();
  let text = '';

  if (mimeType === PDF_MIME || filename.toLowerCase().endsWith('.pdf')) {
    const parsed = await pdfParse(buffer);
    text = parsed.text ?? '';
    logger.debug({ pages: parsed.numpages, ms: Date.now() - startedAt }, 'pdf parsed');
  } else if (mimeType === DOCX_MIME || filename.toLowerCase().endsWith('.docx')) {
    const parsed = await mammoth.extractRawText({ buffer });
    text = parsed.value ?? '';
    logger.debug({ ms: Date.now() - startedAt }, 'docx parsed');
  } else {
    throw new UnsupportedFileError(`Unsupported resume type: ${mimeType}`);
  }

  const cleaned = cleanText(text);

  if (cleaned.length < 50) {
    throw new EmptyResumeError(
      'Could not read any text from this resume. If it is a scanned image, export a text-based PDF and try again.'
    );
  }

  // Guard the LLM context window (and the free-tier token budget).
  return cleaned.slice(0, env.MAX_RESUME_CHARS);
};

export default extractText;
