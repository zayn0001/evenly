'use client';

import { useState } from 'react';

/** Type a name, press Enter or Add; each one becomes a removable chip. */
export function NamesInput({ names, onChange, label }: { names: string[]; onChange: (n: string[]) => void; label: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    const fresh = parts.filter((p) => !names.some((n) => n.toLowerCase() === p.toLowerCase()));
    if (fresh.length) onChange([...names, ...fresh]);
    setDraft('');
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="field">
        {label}
        <div className="row">
          <input
            className="input grow"
            value={draft}
            maxLength={60}
            placeholder="Name, then Enter"
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn small" onClick={add} disabled={!draft.trim()}>
            Add
          </button>
        </div>
      </label>
      {names.length > 0 && (
        <ul className="row wrap" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }} aria-label="People added">
          {names.map((n) => (
            <li key={n}>
              <button type="button" className="chip" aria-label={`Remove ${n}`} onClick={() => onChange(names.filter((x) => x !== n))}>
                {n} <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
