// envConfig validates process.env at import time and exits on failure, so the
// test suite needs a complete (fake) environment before anything is imported.
process.env.NODE_ENV = 'test';
process.env.PORT = '8000';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGIN = '*';
process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/test';
process.env.DATABASE_SSL = 'false';
process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.KAFKA_BROKERS = 'localhost:19092';
process.env.KAFKA_SSL = 'false';
process.env.AWS_REGION = 'ap-south-1';
process.env.S3_BUCKET = 'test-bucket';
