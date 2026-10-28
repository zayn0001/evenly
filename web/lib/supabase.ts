import { createClient } from '@supabase/supabase-js';

// The browser's client. The publishable key is public by design: row-level security in the
// database is what keeps each account's groups private.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);
