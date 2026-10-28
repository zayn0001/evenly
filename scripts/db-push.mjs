// Applies supabase/migrations to the database in the POSTGRES_* settings of the root .env
// (normally the hosted project's session pooler), using the Supabase CLI's own bookkeeping.
//   npm run db:push
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { POSTGRES_HOST, POSTGRES_PORT = '5432', POSTGRES_DB = 'postgres', POSTGRES_USER = 'postgres', POSTGRES_PASSWORD } = process.env;
if (!POSTGRES_HOST || !POSTGRES_PASSWORD) {
  console.error('Set POSTGRES_HOST and POSTGRES_PASSWORD in the root .env (see .env.example).');
  process.exit(1);
}
const local = ['127.0.0.1', 'localhost'].includes(POSTGRES_HOST);
const url = new URL(`postgresql://${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`);
url.username = POSTGRES_USER; // URL encodes them, so passwords with @ or : work
url.password = POSTGRES_PASSWORD;
if (!local) url.searchParams.set('sslmode', 'require');

console.log(`pushing migrations to ${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`);
// The URL holds the password, so the CLI is started directly (no shell to mangle or echo it).
const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const res = spawnSync(process.execPath, [cli, 'db', 'push', '--db-url', url.href, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(res.status ?? 1);
