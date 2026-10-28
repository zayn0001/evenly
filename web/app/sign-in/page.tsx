'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth';
import { Notice, Paper } from '@/components/paper';
import { supabase } from '@/lib/supabase';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

const TITLES: Record<Mode, string> = { 'sign-in': 'Evenly', 'sign-up': 'Create an account', forgot: 'Reset your password' };

export default function SignIn() {
  const { session } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace('/groups');
  }, [session, router]);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setSent(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/groups` },
        });
        if (error) throw error;
        // With email confirmation on, there's no session until they click the link.
        if (!data.session) setSent(`We sent a confirmation link to ${email}. Open it to finish signing up.`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
        if (error) throw error;
        setSent(`If ${email} has an account, a link to set a new password is on its way.`);
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <Paper docket={mode === 'sign-up' ? 'SIGN UP' : 'SIGN IN'} title={TITLES[mode]}>
        {mode === 'sign-in' && <p className="muted">Snap the bill, say who had what, and see what everyone&apos;s share is.</p>}
        <form className="stack" onSubmit={submit}>
          <label className="field">
            Email
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode !== 'forgot' && (
            <label className="field">
              Password
              <input
                className="input"
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === 'sign-up' && <span className="muted">At least 8 characters.</span>}
            </label>
          )}
          <Notice lines={error ? [error] : []} tone="error" />
          <Notice lines={sent ? [sent] : []} />
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : 'Send reset link'}
          </button>
        </form>
        <hr className="rule double" />
        {mode === 'sign-in' ? (
          <div className="stack" style={{ gap: 0 }}>
            <button className="btn ghost" type="button" onClick={() => switchTo('sign-up')}>
              New here? Create an account
            </button>
            <button className="btn ghost" type="button" onClick={() => switchTo('forgot')}>
              Forgot your password?
            </button>
          </div>
        ) : (
          <button className="btn ghost" type="button" onClick={() => switchTo('sign-in')}>
            Back to sign in
          </button>
        )}
      </Paper>
    </main>
  );
}

function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: open the link we sent you.';
  if (/already registered/i.test(message)) return 'There’s already an account with that email. Sign in instead.';
  if (/rate limit/i.test(message)) return 'Too many emails sent just now. Wait a few minutes and try again.';
  return message;
}
