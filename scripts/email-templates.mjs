// Sends supabase/templates/*.html (code-based emails) and the code length to the hosted project's
// auth settings, using the Management API. Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.
//   npm run email:templates
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
if (existsSync(root('.env'))) process.loadEnvFile(root('.env'));
const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = process.env;
if (!token || !ref) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in the root .env.');
  process.exit(1);
}

const settings = {
  mailer_otp_length: 6,
  mailer_otp_exp: 3600,
  mailer_subjects_confirmation: 'Your sign-up code', // subjects are project-wide, so app-neutral
  mailer_templates_confirmation_content: readFileSync(root('supabase/templates/confirmation.html'), 'utf8'),
  mailer_subjects_recovery: 'Your password reset code',
  mailer_templates_recovery_content: readFileSync(root('supabase/templates/recovery.html'), 'utf8'),
};
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
});
if (!res.ok) {
  console.error(`Failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log(`Updated ${Object.keys(settings).length} auth settings on ${ref}.`);
