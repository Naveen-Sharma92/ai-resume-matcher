-- =============================================================================
-- 001_init.sql
-- AI-Powered Job/Resume Matcher - initial schema
--
-- Multi-tenancy model: every business table carries tenant_id and every query
-- in the services is scoped by it. Composite indexes lead with tenant_id so a
-- tenant's rows stay clustered in the index.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector (enabled by default on Supabase)

-- -----------------------------------------------------------------------------
-- updated_at trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  refresh_token  TEXT,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_tenant_email_unique UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- resumes
-- content_hash is the sha256 of the raw file bytes: it is the cache key used by
-- the worker to skip re-parsing / re-embedding an identical upload.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resumes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename  TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  size_bytes         INTEGER NOT NULL,
  s3_key             TEXT NOT NULL,
  content_hash       CHAR(64) NOT NULL,
  parsed_text        TEXT,
  parsed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resumes_tenant_user ON resumes (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resumes_content_hash ON resumes (tenant_id, content_hash);

CREATE OR REPLACE TRIGGER trg_resumes_updated_at
  BEFORE UPDATE ON resumes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- job_descriptions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_descriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT,
  company       TEXT,
  raw_text      TEXT NOT NULL,
  content_hash  CHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jds_tenant_user ON job_descriptions (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jds_content_hash ON job_descriptions (tenant_id, content_hash);

CREATE OR REPLACE TRIGGER trg_jds_updated_at
  BEFORE UPDATE ON job_descriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- match_results - one row per analysis job. Created `queued` by api-service,
-- driven to `completed`/`failed` by worker-service.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id           UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  job_description_id  UUID NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  score               NUMERIC(5, 2),
  summary             TEXT,
  matched_skills      JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_skills      JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestions         JSONB NOT NULL DEFAULT '[]'::jsonb,
  model               TEXT,
  latency_ms          INTEGER,
  attempts            INTEGER NOT NULL DEFAULT 0,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_tenant_user ON match_results (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_status ON match_results (status) WHERE status IN ('queued', 'processing');

CREATE OR REPLACE TRIGGER trg_matches_updated_at
  BEFORE UPDATE ON match_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- match_events - append-only timeline powering GET /matches/:id/status
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id    UUID NOT NULL REFERENCES match_results(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  message     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events (match_id, id);

-- -----------------------------------------------------------------------------
-- embeddings - RAG store. One row per chunk of a resume or a job description.
-- 768 dims == EMBEDDING_DIMENSIONS in shared/src/constants.js
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('resume', 'job_description')),
  owner_id      UUID NOT NULL,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  content_hash  CHAR(64) NOT NULL,
  token_count   INTEGER,
  embedding     VECTOR(768) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT embeddings_owner_chunk_unique UNIQUE (owner_type, owner_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_owner ON embeddings (tenant_id, owner_type, owner_id);

-- HNSW + cosine distance. Matches the `<=>` operator used in the retrieval query.
CREATE INDEX IF NOT EXISTS idx_embeddings_vector_cosine
  ON embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
