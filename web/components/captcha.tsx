'use client';

import { useEffect, useRef, useState } from 'react';

// Cloudflare Turnstile: stops scripts from using the sign-up and code emails to spam people.
// Supabase checks the token on every auth request that sends email or signs in. Without a
// site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY) the check is off and nothing is shown.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let script: Promise<void> | null = null;
const loadScript = () =>
  (script ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      script = null;
      reject(new Error('captcha script failed to load'));
    };
    document.head.appendChild(s);
  }));

/**
 * Tokens are single-use: call reset() after every auth request so the next one gets a fresh one.
 * `token` is undefined when captcha is off, so it can be passed straight to Supabase.
 */
export function useCaptcha() {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: SITE_KEY,
          appearance: 'interaction-only', // invisible unless Cloudflare needs a click
          size: 'flexible',
          callback: (t: string) => {
            setToken(t);
            setFailed(false);
          },
          'expired-callback': () => setToken(null),
          'error-callback': () => {
            setToken(null);
            setFailed(true);
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, []);

  return {
    element: SITE_KEY ? <div ref={box} style={{ minHeight: 0 }} /> : null,
    token: SITE_KEY ? (token ?? undefined) : undefined,
    ready: !SITE_KEY || !!token,
    failed,
    reset: () => {
      setToken(null);
      if (widget.current) window.turnstile?.reset(widget.current);
    },
  };
}
