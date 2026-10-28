'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

/** "28 OCT 2026 14:05", like a fax transmission header. */
function faxStamp(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = d.toLocaleString('en', { month: 'short' }).toUpperCase();
  return `${pad(d.getDate())} ${month} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const never = () => () => {};
/** A value only the browser knows (clock, settings); '' or false while rendering on the server. */
const useClientValue = <T,>(get: () => T, server: T) => useSyncExternalStore(never, get, () => server);
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A page: a sheet of receipt paper feeding out of the machine's slot, with a transmission header
 * and a torn-off bottom. `title` types itself out.
 */
export function Paper({ docket, title, children }: { docket: string; title?: string; children: ReactNode }) {
  const sentAt = useClientValue(() => faxStamp(new Date()), '');
  return (
    <>
      <div className="slot" aria-hidden />
      <div className="feed">
        <section className="paper">
          <div className="fax-head" aria-hidden>
            <span>FAX {sentAt}</span>
            <span>{docket} P.01</span>
          </div>
          <hr className="rule" />
          {title ? <Typewriter text={title} /> : null}
          {children}
          <p className="end" aria-hidden>
            ** END OF TRANSMISSION **
          </p>
          <div className="cut" aria-hidden>
            ✂ {'- '.repeat(40)}
          </div>
        </section>
      </div>
    </>
  );
}

function Typewriter({ text }: { text: string }) {
  const reduced = useClientValue(prefersReducedMotion, false);
  const [typed, setTyped] = useState({ text, n: 0 });
  if (typed.text !== text) setTyped({ text, n: 0 }); // a new title types out from the start
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(
      () => setTyped((t) => (t.n >= t.text.length ? (clearInterval(timer), t) : { ...t, n: t.n + 1 })),
      35,
    );
    return () => clearInterval(timer);
  }, [text, reduced]);
  const shown = reduced ? text.length : Math.min(typed.n, text.length);
  return (
    <h1 aria-label={text}>
      <span aria-hidden>
        {text.slice(0, shown)}
        {shown < text.length ? '▌' : ''}
      </span>
    </h1>
  );
}

/** "Label ......... value" */
export function Line({ label, value, bold, color }: { label: ReactNode; value: ReactNode; bold?: boolean; color?: string }) {
  return (
    <div className={`line${bold ? ' bold' : ''}`} style={color ? { color } : undefined}>
      <span>{label}</span>
      <span className="dots" aria-hidden />
      <span className="amount">{value}</span>
    </div>
  );
}

export const Rule = ({ double }: { double?: boolean }) => <hr className={`rule${double ? ' double' : ''}`} />;

export function Notice({ lines, tone }: { lines: string[]; tone?: 'error' }) {
  if (!lines.length) return null;
  return (
    <div className={`notice${tone === 'error' ? ' error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      {lines.length === 1 ? lines[0] : <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
    </div>
  );
}

/** A short confirmation at the bottom of the screen ("Copied"). */
export function useToast() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 1800);
    return () => clearTimeout(t);
  }, [text]);
  const toast = text ? (
    <div className="toast" role="status">
      {text}
    </div>
  ) : null;
  return [toast, setText] as const;
}
