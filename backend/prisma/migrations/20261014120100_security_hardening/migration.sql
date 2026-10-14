-- Security hardening for Supabase.
--
-- Supabase exposes the "public" schema through its REST/GraphQL APIs to the
-- built-in "anon" and "authenticated" roles. These analytics tables must only
-- be reachable through the DataPulse backend, so:
--   1. Row Level Security is enabled with NO policies for anon/authenticated
--      (deny by default).
--   2. All privileges are revoked from those roles.
-- The dedicated read-only role and its SELECT policies are created by
-- `npm run db:setup-role` (prisma/scripts/setup-analytics-role.ts), because
-- that step needs a password that must never be committed.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "users", "products", "orders" FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON TABLE public._prisma_migrations FROM %I', r);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Migration history is internal; hide it from Supabase's API roles too.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Nobody but the owner may create objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
