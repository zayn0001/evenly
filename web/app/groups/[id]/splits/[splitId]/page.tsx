'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SignedIn } from '@/components/auth';
import { Line, Notice, Paper, Rule, useToast } from '@/components/paper';
import { SplitLines } from '@/components/split-editor';
import { deleteSplit, getSplit, type Split } from '@/lib/db';
import { rupees, shortDate } from '@/lib/format';

export default function SplitPage() {
  return (
    <SignedIn>
      <SplitView />
    </SignedIn>
  );
}

function SplitView() {
  const { id: groupId, splitId } = useParams<{ id: string; splitId: string }>();
  const router = useRouter();
  const [split, setSplit] = useState<Split | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [toast, show] = useToast();

  useEffect(() => {
    getSplit(splitId).then(setSplit).catch((e) => setError(e.message));
  }, [splitId]);

  if (split === undefined) return <Paper docket="SPLIT">{error ? <Notice lines={[error]} tone="error" /> : <p className="muted">Loading…</p>}</Paper>;
  if (split === null) {
    return (
      <Paper docket="SPLIT" title="Not found">
        <p className="muted">This split was deleted, or it belongs to another account.</p>
        <Link href={`/groups/${groupId}`}>Back to the group</Link>
      </Paper>
    );
  }

  const { receipt } = split;
  const summary = [
    `${split.title}: ${rupees(split.total)}`,
    ...split.result.people.map((p) => `${p.name}: ${rupees(p.total)}`),
  ].join('\n');

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text: summary });
      else {
        await navigator.clipboard.writeText(summary);
        show('Copied the summary');
      }
    } catch {
      // closing the share sheet throws; nothing to do
    }
  };
  const remove = async () => {
    if (!confirm(`Delete “${split.title}”? This can't be undone.`)) return;
    try {
      await deleteSplit(split.id);
      router.replace(`/groups/${groupId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Paper docket="SPLIT" title={split.title}>
        <p className="muted">
          {shortDate(split.created_at)}
          {split.updated_at.slice(0, 16) !== split.created_at.slice(0, 16) ? ` · edited ${shortDate(split.updated_at)}` : ''}
        </p>
        <span className="stamp" aria-label="Saved">
          SAVED
        </span>
        <Notice lines={error ? [error] : []} tone="error" />
        <SplitLines result={split.result} />

        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 40 }}>The bill</summary>
          <div className="stack" style={{ gap: 2, paddingTop: 6 }}>
            {receipt.restaurant && <p className="muted">{receipt.restaurant}</p>}
            {receipt.items.map((i) => (
              <Line key={i.id} label={i.qty > 1 ? `${i.qty} × ${i.name}` : i.name} value={rupees(i.total)} />
            ))}
            {[...receipt.charges, ...receipt.taxes].map((a, n) => (
              <Line key={n} label={<span className="muted">{a.name}</span>} value={<span className="muted">{rupees(a.amount)}</span>} />
            ))}
            {receipt.round_off !== 0 && <Line label={<span className="muted">Round off</span>} value={<span className="muted">{rupees(receipt.round_off)}</span>} />}
            <Rule />
            <Line label="Grand total" value={rupees(receipt.grand_total)} bold />
          </div>
        </details>
        <button className="link danger" type="button" onClick={remove} style={{ alignSelf: 'flex-start' }}>
          Delete this split
        </button>
      </Paper>
      <div className="actions">
        <button className="btn primary" type="button" onClick={share}>
          Share the amounts
        </button>
        <div className="row">
          <Link className="btn" href={`/groups/${groupId}/split/${split.id}`}>
            Edit
          </Link>
          <Link className="btn" href={`/groups/${groupId}`}>
            Back to group
          </Link>
        </div>
      </div>
      {toast}
    </>
  );
}
