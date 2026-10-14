import type { PoolConfig } from 'pg';

export type SslMode = 'require' | 'verify' | 'disable';

/**
 * Build a pg PoolConfig from a connection URL.
 *
 * `sslmode` is stripped from the URL because node-postgres lets URL parameters
 * override the explicit `ssl` option. TLS is then configured explicitly:
 *  - require: encrypted, without CA verification (works with Supabase out of the box)
 *  - verify:  encrypted + CA verification (provide DATABASE_CA_CERT, PEM text)
 *  - disable: plain TCP, for local development databases only
 */
export function buildPoolConfig(
  connectionUrl: string,
  sslMode: SslMode = 'require',
  caCert?: string,
): PoolConfig {
  const url = new URL(connectionUrl);
  for (const p of [
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey',
    'uselibpqcompat',
  ]) {
    url.searchParams.delete(p);
  }

  let ssl: PoolConfig['ssl'];
  if (sslMode === 'disable') ssl = false;
  else if (sslMode === 'verify')
    ssl = { rejectUnauthorized: true, ...(caCert ? { ca: caCert } : {}) };
  else ssl = { rejectUnauthorized: false };

  return { connectionString: url.toString(), ssl };
}

/** Database user name from a connection URL (Supabase pooler users look like `role.projectref`). */
export function connectionUser(
  connectionUrl: string | undefined,
): string | null {
  if (!connectionUrl) return null;
  try {
    const user = decodeURIComponent(new URL(connectionUrl).username);
    return user.split('.')[0] || null;
  } catch {
    return null;
  }
}
