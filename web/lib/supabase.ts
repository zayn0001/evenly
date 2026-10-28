import { createClient } from '@supabase/supabase-js';

// The browser's client. The publishable key is public by design: row-level security in the
// database is what keeps each account's groups private.
// Evenly's tables and functions live in their own `evenly` schema (the project is shared with other apps).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { db: { schema: 'evenly' } },
);
