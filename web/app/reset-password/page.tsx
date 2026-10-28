'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth';
import { Notice, Paper } from '@/components/paper';
import { supabase } from '@/lib/supabase';

/** Where the "reset your password" email lands: the link signs you in, then you pick a new one. */
export default function ResetPassword() {
  const { session, ready } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else router.replace('/groups');
  };

  return (
    <main className="page">
      <Paper docket="RESET" title="New password">
        {ready && !session ? (
          <Notice lines={['This link has expired or was already used. Ask for a new one from the sign-in page.']} tone="error" />
        ) : (
          <form className="stack" onSubmit={submit}>
            <label className="field">
              New password
              <input className="input" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="muted">At least 8 characters.</span>
            </label>
            <Notice lines={error ? [error] : []} tone="error" />
            <button className="btn primary" type="submit" disabled={busy || !session}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </form>
        )}
        <button className="btn ghost" type="button" onClick={() => router.replace('/sign-in')}>
          Back to sign in
        </button>
      </Paper>
    </main>
  );
}
