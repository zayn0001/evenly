// Server only: who's calling an API route, and whether they still have AI calls left today.
import { createClient } from '@supabase/supabase-js';

const LIMITS = {
  scan: () => Number(process.env.AI_SCANS_PER_DAY || 40),
  assign: () => Number(process.env.AI_ASSIGNS_PER_DAY || 100),
};

export const fail = (status: number, detail: string) => Response.json({ detail }, { status });

/**
 * The caller must send their Supabase access token. Returns an error Response for anyone
 * signed out or over today's quota (counted per user in the database, so it holds across
 * serverless instances).
 */
export async function guard(request: Request, kind: keyof typeof LIMITS): Promise<Response | null> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  if (!token) return fail(401, 'Sign in first.');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: authError } = await supabase.auth.getUser(token);
  if (authError) return fail(401, 'Your session has expired. Sign in again.');
  const { data: allowed, error } = await supabase.rpc('use_ai', { p_kind: kind, p_daily_limit: LIMITS[kind]() });
  if (error) return fail(500, `Couldn't check today's limit: ${error.message}`);
  if (!allowed) {
    const what = kind === 'scan' ? 'bill scans' : 'voice and typed splits';
    return fail(429, `That's today's ${LIMITS[kind]()} ${what}. It resets at midnight (UTC). You can still enter or tap things in by hand.`);
  }
  return null;
}
