'use client';

import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

const Ctx = createContext<{ session: Session | null; ready: boolean }>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, ready: true }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, ready: true }));
    return () => data.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Pages behind sign-in: shows the top bar, or sends signed-out visitors to /sign-in. */
export function SignedIn({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && !session) router.replace('/sign-in');
  }, [ready, session, router]);
  if (!session) return <p className="muted" style={{ color: 'var(--paper)', padding: 16 }}>Loading…</p>;
  return (
    <main className="page">
      <nav className="topbar" aria-label="Account">
        <Link href="/groups" className="brand">
          Evenly
        </Link>
        <span className="row" style={{ gap: 4, minWidth: 0 }}>
          <span className="account-email">{session.user.email}</span>
          <button type="button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </span>
      </nav>
      {children}
    </main>
  );
}
