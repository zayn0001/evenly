// Runs a command with the repo-root .env loaded into its environment.
//   node scripts/with-env.mjs <command> [args...]
// Used by the website (Next.js inlines NEXT_PUBLIC_* from the environment at build time).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
else console.warn(`warning: ${envFile} not found (copy .env.example to .env)`);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-env.mjs <command> [args...]');
  process.exit(2);
}
// One command string through the shell (args come from our own package.json scripts, not users).
const child = spawn([command, ...args].join(' '), { stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
