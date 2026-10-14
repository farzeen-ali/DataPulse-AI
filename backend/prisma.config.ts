import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (migrate, seed, studio).
 *
 * The CLI uses the OWNER / direct connection (SUPABASE_DIRECT_URL, port 5432).
 * The running API never uses it — it connects with the least-privilege
 * analytics role through SUPABASE_DATABASE_URL instead.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` does not need a database, so fall back to a placeholder.
    url:
      process.env.SUPABASE_DIRECT_URL ??
      'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
