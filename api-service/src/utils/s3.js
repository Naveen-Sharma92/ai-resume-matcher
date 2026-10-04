import fs from 'node:fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../envConfig.js';
import { logger } from './logger.js';

/**
 * Raw resumes live in S3, never in Postgres. The DB only stores the key.
 * Credentials fall back to the default AWS provider chain when the explicit
 * env vars are empty (handy if you ever move this onto an EC2/ECS role).
 */
const s3 = new S3Client({
  region: env.AWS_REGION,
  // MinIO/LocalStack need an explicit endpoint and path-style addressing;
  // with S3_ENDPOINT unset this is exactly the plain AWS S3 client.
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
  ...(env.S3_FORCE_PATH_STYLE ? { forcePathStyle: true } : {}),
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

export const uploadFileToS3 = async ({ filePath, key, contentType, metadata = {} }) => {
  const body = fs.createReadStream(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
      ServerSideEncryption: 'AES256',
    })
  );
  logger.debug({ key }, 's3 upload complete');
  return { bucket: env.S3_BUCKET, key };
};

export const getPresignedDownloadUrl = async (key, expiresIn = env.S3_PRESIGN_EXPIRY_SECONDS) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn });

export const deleteFromS3 = async (key) =>
  s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));

/** Best-effort cleanup of the multer temp file. Never throws. */
export const removeLocalFile = (filePath) => {
  if (!filePath) return;
  fs.promises
    .unlink(filePath)
    .catch((err) => logger.warn({ err, filePath }, 'temp cleanup failed'));
};

export { s3 };
