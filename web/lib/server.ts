// Server only: who's calling an API route, and whether they're within the hourly AI limits.
import { createClient } from '@supabase/supabase-js';

import { createLimiter } from './rate-limit';

const num = (key: string, fallback: number) => Number(process.env[key]) || fallback;
const LIMITS = {
  scan: { perUser: () => num('AI_SCANS_PER_HOUR', 20), total: () => num('AI_SCANS_TOTAL_PER_HOUR', 200), what: 'bill scans' },
  assign: { perUser: () => num('AI_ASSIGNS_PER_HOUR', 40), total: () => num('AI_ASSIGNS_TOTAL_PER_HOUR', 400), what: 'voice and typed splits' },
};

// Kept on globalThis so dev-mode hot reloads don't reset the counts.
const store = globalThis as unknown as { evenlyLimiter?: ReturnType<typeof createLimiter> };
const limiter = (store.evenlyLimiter ??= createLimiter(60 * 60 * 1000));

export const fail = (status: number, detail: string, headers?: HeadersInit) => Response.json({ detail }, { status, headers });

/**
 * The caller must send their Supabase access token. Returns an error Response for anyone signed
 * out, over their own hourly limit, or when everyone together has hit the hourly cap (which
 * protects the free AI quotas).
 */
export async function guard(request: Request, kind: keyof typeof LIMITS): Promise<Response | null> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  if (!token) return fail(401, 'Sign in first.');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return fail(401, 'Your session has expired. Sign in again.');

  const limit = LIMITS[kind];
  const userKey = `${kind}:${data.user.id}`;
  let res = limiter.take(userKey, limit.perUser());
  let reason = `${limit.perUser()} ${limit.what} an hour`;
  if (res.ok) {
    res = limiter.take(`${kind}:*`, limit.total());
    if (!res.ok) {
      limiter.giveBack(userKey); // this request didn't happen
      reason = `${limit.total()} ${limit.what} an hour across everyone`;
    }
  }
  if (res.ok) return null;
  const minutes = Math.max(1, Math.ceil(res.retryMs / 60_000));
  return fail(
    429,
    `That's the limit of ${reason}. Try again in about ${minutes} min, or enter or tap things in by hand meanwhile.`,
    { 'Retry-After': String(Math.ceil(res.retryMs / 1000)) },
  );
}
