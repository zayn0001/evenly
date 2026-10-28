'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { SignedIn } from '@/components/auth';
import { NamesInput } from '@/components/names-input';
import { Notice, Paper, Rule } from '@/components/paper';
import { createGroup, listGroups, type GroupSummary } from '@/lib/db';

const MY_NAME_KEY = 'evenly:my-name';

export default function GroupsPage() {
  return (
    <SignedIn>
      <Groups />
    </SignedIn>
  );
}

function Groups() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => listGroups().then(setGroups).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Paper docket="GROUPS" title="Your groups">
      <Notice lines={error ? [error] : []} tone="error" />
      {groups === null && !error && <p className="muted">Loading…</p>}
      {groups?.length === 0 && !creating && (
        <p className="muted">No groups yet. Make one for the people you eat out with, then split a bill in it.</p>
      )}
      {groups?.map((g) => (
        <Link key={g.id} href={`/groups/${g.id}`} className="stack" style={{ gap: 2, color: 'inherit', textDecoration: 'none', padding: '4px 0' }}>
          <span className="row between">
            <strong style={{ fontSize: 17, overflowWrap: 'anywhere' }}>{g.name}</strong>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>
              {g.splits[0]?.count ?? 0} split{g.splits[0]?.count === 1 ? '' : 's'} ›
            </span>
          </span>
          <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {g.members.map((m) => (m.is_me ? 'you' : m.name)).join(', ') || 'No people yet'}
          </span>
          <Rule />
        </Link>
      ))}

      {creating ? (
        <NewGroup
          onCancel={() => setCreating(false)}
          onCreated={(id) => router.push(`/groups/${id}`)}
        />
      ) : (
        <button className="btn primary" type="button" onClick={() => setCreating(true)}>
          New group
        </button>
      )}
    </Paper>
  );
}

function NewGroup({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [me, setMe] = useState(() => (typeof window === 'undefined' ? '' : (safeGet(MY_NAME_KEY) ?? '')));
  const [others, setOthers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (me.trim()) safeSet(MY_NAME_KEY, me.trim());
      onCreated(await createGroup(name.trim(), me.trim(), others));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} aria-label="New group">
      <h2>New group</h2>
      <label className="field">
        Group name
        <input className="input" required maxLength={80} placeholder="Goa trip, Flat 4B…" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Your name
        <input className="input" maxLength={60} placeholder="So “I had the biryani” means you" value={me} onChange={(e) => setMe(e.target.value)} />
      </label>
      <NamesInput label="Everyone else" names={others} onChange={setOthers} />
      <Notice lines={error ? [error] : []} tone="error" />
      <button className="btn primary" type="submit" disabled={busy || !name.trim() || (!me.trim() && others.length === 0)}>
        {busy ? 'Creating…' : 'Create group'}
      </button>
      <button className="btn ghost" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

// localStorage can throw (private mode, blocked storage); the name is only a convenience.
function safeGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
