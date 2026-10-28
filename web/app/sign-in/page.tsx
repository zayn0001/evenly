'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '@/components/auth';
import { Notice, Paper } from '@/components/paper';
import { supabase } from '@/lib/supabase';

// sign-in / sign-up -> (code emailed) verify;  forgot -> (code emailed) reset
type Mode = 'sign-in' | 'sign-up' | 'verify' | 'forgot' | 'reset';

const TITLES: Record<Mode, string> = {
  'sign-in': 'Evenly',
  'sign-up': 'Create an account',
  verify: 'Check your email',
  forgot: 'Reset your password',
  reset: 'Set a new password',
};
const BUTTONS: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create account',
  verify: 'Confirm',
  forgot: 'Email me a code',
  reset: 'Save new password',
};

export default function SignIn() {
  const { session } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace('/groups');
  }, [session, router]);

  const go = (m: Mode, message: string | null = null) => {
    setMode(m);
    setError(null);
    setInfo(message);
    setCode('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error?.code === 'email_not_confirmed') {
          await supabase.auth.resend({ type: 'signup', email });
          return go('verify', `Confirm your email first: we sent a new code to ${email}.`);
        }
        if (error) throw error;
      } else if (mode === 'sign-up') {
        // Tags the account as Evenly's, so the shared Supabase email templates use Evenly's design.
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { app: 'evenly' } } });
        if (error) throw error;
        // With "Confirm email" on there's no session until the emailed code is entered.
        if (!data.session) go('verify', `We sent a 6-digit code to ${email}.`);
      } else if (mode === 'verify') {
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' });
        if (error) throw error; // success signs you in; the effect above moves on
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        go('reset', `If ${email} has an account, a 6-digit code is on its way.`);
      } else {
        // The code signs you in for this one purpose; then the new password is saved.
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
        if (error) throw error;
        const { error: saveError } = await supabase.auth.updateUser({ password });
        if (saveError) throw saveError;
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    const { error } =
      mode === 'verify' ? await supabase.auth.resend({ type: 'signup', email }) : await supabase.auth.resetPasswordForEmail(email);
    if (error) setError(friendly(error.message));
    else setInfo(`Sent a new code to ${email}.`);
  };

  const needsCode = mode === 'verify' || mode === 'reset';
  const needsPassword = mode === 'sign-in' || mode === 'sign-up' || mode === 'reset';

  return (
    <main className="page">
      <Paper docket={mode === 'sign-up' || mode === 'verify' ? 'SIGN UP' : 'SIGN IN'} title={TITLES[mode]}>
        {mode === 'sign-in' && <p className="muted">Snap the bill, say who had what, and see what everyone&apos;s share is.</p>}
        <form className="stack" onSubmit={submit}>
          <label className="field">
            Email
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              readOnly={needsCode}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {needsCode && (
            <label className="field">
              Code from the email
              <input
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                maxLength={10}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                style={{ letterSpacing: 6, fontWeight: 700 }}
              />
            </label>
          )}
          {needsPassword && (
            <label className="field">
              {mode === 'reset' ? 'New password' : 'Password'}
              <input
                className="input"
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== 'sign-in' && <span className="muted">At least 8 characters.</span>}
            </label>
          )}
          <Notice lines={info ? [info] : []} />
          <Notice lines={error ? [error] : []} tone="error" />
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : BUTTONS[mode]}
          </button>
        </form>
        {needsCode && (
          <button className="btn ghost" type="button" onClick={resend}>
            Send a new code
          </button>
        )}
        <hr className="rule double" />
        {mode === 'sign-in' ? (
          <div className="stack" style={{ gap: 0 }}>
            <button className="btn ghost" type="button" onClick={() => go('sign-up')}>
              New here? Create an account
            </button>
            <button className="btn ghost" type="button" onClick={() => go('forgot')}>
              Forgot your password?
            </button>
          </div>
        ) : (
          <button className="btn ghost" type="button" onClick={() => go('sign-in')}>
            Back to sign in
          </button>
        )}
      </Paper>
    </main>
  );
}

function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/already registered/i.test(message)) return 'There’s already an account with that email. Sign in instead.';
  if (/expired|invalid/i.test(message) && /otp|token|code/i.test(message)) return 'That code is wrong or has expired. Check the latest email, or send a new code.';
  if (/rate limit|security purposes/i.test(message)) return 'Too many emails just now. Wait a minute and try again.';
  if (/should be different/i.test(message)) return 'Pick a password different from your old one.';
  return message;
}
