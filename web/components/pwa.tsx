'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the service worker (production only, so it never caches dev builds). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
  }, []);
  return null;
}

const never = () => () => {};
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const DISMISSED = 'evenly:install-dismissed';
const wasDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
};

/** "Install Evenly": the browser's own prompt where there is one (Android, desktop), instructions on iPhone. */
export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const installed = useSyncExternalStore(never, isStandalone, () => true);
  const ios = useSyncExternalStore(never, isIos, () => false);
  const dismissed = useSyncExternalStore(never, wasDismissed, () => true);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // show our own button instead of the mini-infobar
      setPrompt(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (installed || dismissed || hidden || (!prompt && !ios)) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {}
  };

  return (
    <div className="notice row between" role="note">
      <span>
        {prompt ? (
          'Add Evenly to your home screen for one-tap access.'
        ) : (
          <>
            Add Evenly to your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </>
        )}
      </span>
      <span className="row" style={{ gap: 4, flex: 'none' }}>
        {prompt && (
          <button
            type="button"
            className="btn small"
            onClick={async () => {
              await prompt.prompt();
              await prompt.userChoice;
              setPrompt(null);
            }}
          >
            Install
          </button>
        )}
        <button type="button" className="link" onClick={dismiss} aria-label="Dismiss">
          Not now
        </button>
      </span>
    </div>
  );
}
