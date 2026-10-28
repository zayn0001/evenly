'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { SignedIn } from '@/components/auth';
import { NamesInput } from '@/components/names-input';
import { Line, Notice, Paper, Rule } from '@/components/paper';
import { addMember, deleteGroup, getGroup, removeMember, renameGroup, renameMember, type Group, type Member, type Split } from '@/lib/db';
import { rupees, shortDate } from '@/lib/format';

export default function GroupPage() {
  return (
    <SignedIn>
      <GroupView />
    </SignedIn>
  );
}

function GroupView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ group: Group | null; members: Member[]; splits: Split[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingPeople, setEditingPeople] = useState(false);

  const load = useCallback(() => getGroup(id).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!data) return <Paper docket="GROUP">{error ? <Notice lines={[error]} tone="error" /> : <p className="muted">Loading…</p>}</Paper>;
  if (!data.group) {
    return (
      <Paper docket="GROUP" title="Not found">
        <p className="muted">This group doesn&apos;t exist, or it belongs to another account.</p>
        <Link href="/groups">Back to your groups</Link>
      </Paper>
    );
  }
  const { group, members, splits } = data;

  const rename = () => {
    const name = prompt('Group name', group.name)?.trim();
    if (name && name !== group.name) run(() => renameGroup(group.id, name));
  };
  const remove = () => {
    if (confirm(`Delete “${group.name}” and its ${splits.length} split${splits.length === 1 ? '' : 's'}? This can't be undone.`)) {
      run(async () => {
        await deleteGroup(group.id);
        router.replace('/groups');
      });
    }
  };

  return (
    <>
      <Paper docket="GROUP" title={group.name}>
        <Notice lines={error ? [error] : []} tone="error" />
        <div className="row between">
          <h2>People</h2>
          <button className="link" type="button" onClick={() => setEditingPeople((v) => !v)}>
            {editingPeople ? 'Done' : 'Edit people'}
          </button>
        </div>
        {members.length === 0 && <p className="muted">Nobody yet. Add the people you split with.</p>}
        {editingPeople ? (
          <PeopleEditor members={members} run={run} groupId={group.id} />
        ) : (
          <p>{members.map((m) => (m.is_me ? `${m.name} (you)` : m.name)).join(', ')}</p>
        )}
        <Rule double />

        <h2>Splits</h2>
        <p className="muted">Your 10 most recent splits are kept, across all your groups.</p>
        {splits.length === 0 && <p className="muted">No splits yet. Scan a bill or type one in.</p>}
        {splits.map((s) => (
          <Link key={s.id} href={`/groups/${group.id}/splits/${s.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <Line label={<strong>{s.title}</strong>} value={rupees(s.total)} />
            <span className="muted">
              {shortDate(s.created_at)} · {s.result.people.length} people
            </span>
          </Link>
        ))}
        <Rule />
        <div className="row wrap" style={{ gap: 0 }}>
          <button className="link" type="button" onClick={rename}>
            Rename group
          </button>
          <button className="link danger" type="button" onClick={remove} style={{ marginLeft: 'auto' }}>
            Delete group
          </button>
        </div>
      </Paper>
      <div className="actions">
        {members.length === 0 ? (
          <p className="muted" style={{ color: '#c9d2d6', textAlign: 'center' }}>
            Add people first, then you can split a bill.
          </p>
        ) : (
          <Link className="btn primary" href={`/groups/${group.id}/split/new`}>
            New split
          </Link>
        )}
        <Link className="btn ghost" href="/groups">
          All groups
        </Link>
      </div>
    </>
  );
}

function PeopleEditor({ members, run, groupId }: { members: Member[]; groupId: string; run: (t: () => Promise<unknown>) => void }) {
  const [adding, setAdding] = useState<string[]>([]);
  return (
    <div className="stack">
      {members.map((m) => (
        <div key={m.id} className="row">
          <span className="grow" style={{ overflowWrap: 'anywhere' }}>
            {m.name}
            {m.is_me ? ' (you)' : ''}
          </span>
          <button
            className="link"
            type="button"
            onClick={() => {
              const name = prompt('Name', m.name)?.trim();
              if (name && name !== m.name) run(() => renameMember(m.id, name));
            }}
          >
            Rename
          </button>
          <button
            className="link danger"
            type="button"
            onClick={() => confirm(`Remove ${m.name}? Splits already saved keep their name.`) && run(() => removeMember(m.id))}
          >
            Remove
          </button>
        </div>
      ))}
      <NamesInput
        label="Add people"
        names={adding}
        onChange={(names) => {
          const fresh = names.filter((n) => !adding.includes(n));
          setAdding([]);
          run(async () => {
            for (const n of fresh) await addMember(groupId, n);
          });
        }}
      />
    </div>
  );
}
