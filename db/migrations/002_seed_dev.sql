-- =============================================================================
-- 002_seed_dev.sql
-- Local-development seed only. Safe to run repeatedly.
-- Creates a demo tenant so `npm run dev` has something to attach users to.
-- Password for demo@local.test is "Password123!" (bcrypt, 10 rounds).
-- =============================================================================

INSERT INTO tenants (id, name, slug, plan)
VALUES ('00000000-0000-4000-8000-000000000001', 'Demo Tenant', 'demo', 'free')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (id, tenant_id, email, full_name, password_hash, role)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'demo@local.test',
  'Demo User',
  '$2b$10$Y27ELADhWkQNz7r8tFL82OPIzz5e9bA80WR5HBiEcWjuBAQcBUVHS',
  'owner'
)
ON CONFLICT (tenant_id, email) DO NOTHING;
