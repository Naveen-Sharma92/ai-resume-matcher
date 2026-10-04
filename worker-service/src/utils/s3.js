import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../envConfig.js';

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

/** Resumes are <= 5 MB, so buffering the whole object is fine here. */
export const downloadFromS3 = async (key) => {
  const response = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

export { s3 };
