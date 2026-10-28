'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BillEditor, emptyReceipt } from '@/components/bill-editor';
import { Line, Notice, Paper, Rule, useToast } from '@/components/paper';
import { Recorder } from '@/components/recorder';
import { assign, scanBill, shrinkImage, toDataUrl } from '@/lib/api';
import { counted, itemStatus, shareEqually, type ItemStatus } from '@/lib/assign';
import { getGroup, getSplit, saveSplit, type Member } from '@/lib/db';
import { fmtUnits, plainAmount, rupees } from '@/lib/format';
import { reconcile, withImpliedRoundOff } from '@/lib/reconcile';
import { SplitError, splitBill } from '@/lib/split';
import type { Assignments, Person, Receipt, SplitResult } from '@/lib/types';

type Step = 'bill' | 'who' | 'result';
/** `photo` is the shrunk bill photo (data: URL), kept only in this tab so it can be shown while assigning. */
type Draft = { step: Step; receipt: Receipt | null; assignments: Assignments; title: string; photo?: string | null };
const STEPS: { step: Step; label: string }[] = [
  { step: 'bill', label: '1 Bill' },
  { step: 'who', label: '2 Who had what' },
  { step: 'result', label: '3 Split' },
];

/** New split (no splitId) or editing a saved one. */
export function SplitEditor({ groupId, splitId }: { groupId: string; splitId?: string }) {
  const router = useRouter();
  const draftKey = `evenly:draft:${groupId}:${splitId ?? 'new'}`;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the group's people, then the saved split (when editing), or an unsaved draft: phones can
  // reload the tab while the camera is open, and nobody wants to re-scan.
  useEffect(() => {
    let live = true;
    (async () => {
      const { members } = await getGroup(groupId);
      const saved = readDraft(draftKey);
      let start: Draft = saved ?? { step: 'bill', receipt: null, assignments: {}, title: '' };
      if (!saved && splitId) {
        const s = await getSplit(splitId);
        if (!s) throw new Error('That split no longer exists.');
        start = { step: 'bill', receipt: s.receipt, assignments: s.assignments, title: s.title };
      }
      if (live) {
        setMembers(members);
        setDraftState(start);
      }
    })().catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [groupId, splitId, draftKey]);

  const setDraft = (patch: Partial<Draft>) =>
    setDraftState((d) => {
      const nextDraft = { ...d!, ...patch };
      writeDraft(draftKey, nextDraft);
      return nextDraft;
    });

  if (error) return <Paper docket="SPLIT"><Notice lines={[error]} tone="error" /><Link href={`/groups/${groupId}`}>Back to the group</Link></Paper>;
  if (!members || !draft) return <Paper docket="SPLIT"><p className="muted">Loading…</p></Paper>;

  const people: Person[] = members.map((m) => ({ id: m.id, name: m.name }));
  const meId = members.find((m) => m.is_me)?.id ?? null;
  // People removed from the group since this split was made drop out of it.
  const known = new Set(people.map((p) => p.id));
  const assignments: Assignments = Object.fromEntries(
    Object.entries(draft.assignments).map(([item, shares]) => [item, Object.fromEntries(Object.entries(shares).filter(([pid]) => known.has(pid)))]),
  );

  const leave = () => {
    clearDraft(draftKey);
    router.push(splitId ? `/groups/${groupId}/splits/${splitId}` : `/groups/${groupId}`);
  };

  return (
    <>
      <nav className="steps" aria-label="Steps" style={{ padding: '0 6px 8px', color: '#9fb0b8' }}>
        {STEPS.map((s) => (
          <span key={s.step} aria-current={s.step === draft.step ? 'step' : undefined} style={s.step === draft.step ? { color: 'var(--paper)' } : undefined}>
            {s.label}
          </span>
        ))}
      </nav>
      {draft.step === 'bill' && (
        <BillStep
          receipt={draft.receipt}
          photo={draft.photo ?? null}
          onPhoto={(photo) => setDraft({ photo })}
          onReceipt={(receipt) => setDraft({ receipt })}
          onNext={(receipt) => setDraft({ receipt, step: 'who', title: draft.title || receipt.restaurant || '' })}
          onCancel={leave}
        />
      )}
      {draft.step === 'who' && draft.receipt && (
        <WhoStep
          receipt={draft.receipt}
          photo={draft.photo ?? null}
          people={people}
          meId={meId}
          assignments={assignments}
          onChange={(a) => setDraft({ assignments: a })}
          onItemSplit={(receipt, a) => setDraft({ receipt, assignments: a })}
          onBack={() => setDraft({ step: 'bill' })}
          onNext={() => setDraft({ step: 'result' })}
        />
      )}
      {draft.step === 'result' && draft.receipt && (
        <ResultStep
          receipt={draft.receipt}
          people={people}
          assignments={assignments}
          title={draft.title}
          onTitle={(title) => setDraft({ title })}
          onBack={() => setDraft({ step: 'who' })}
          onSave={async (result) => {
            const id = await saveSplit({ id: splitId, groupId, title: draft.title.trim() || 'Bill', receipt: draft.receipt!, assignments, result });
            clearDraft(draftKey);
            router.push(`/groups/${groupId}/splits/${id}`);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- 1. the bill
function BillStep({
  receipt,
  photo,
  onPhoto,
  onReceipt,
  onNext,
  onCancel,
}: {
  receipt: Receipt | null;
  photo: string | null;
  onPhoto: (p: string | null) => void;
  onReceipt: (r: Receipt | null) => void;
  onNext: (r: Receipt) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanIssues, setScanIssues] = useState<string[]>([]);
  // After every read the numbers are checked; if they never added up, say so.
  const [unmatched, setUnmatched] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const scan = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const small = await shrinkImage(file);
      onPhoto(await toDataUrl(small).catch(() => null));
      const res = await scanBill(small);
      setScanIssues(res.issues);
      setUnmatched(res.checksOut ? null : res.reads);
      onReceipt(res.receipt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const issues = receipt ? (receipt.grand_total ? reconcile(receipt) : []) : scanIssues;
  const blank = receipt?.items.filter((i) => !i.name.trim()) ?? [];
  // The split is only as right as the bill: no going on until the lines add up to the printed totals.
  const mustFix = issues.length > 0;
  const continueWith = () => {
    if (!receipt) return;
    const items = receipt.items.filter((i) => i.name.trim() || i.total);
    const computed = items.reduce((t, i) => t + i.total, 0) + [...receipt.charges, ...receipt.taxes].reduce((t, a) => t + a.amount, 0) + receipt.round_off;
    // Typed-in bills often skip the grand total; use what the lines add up to. A bill whose total
    // is rounded without a round-off line gets one, so the split matches the printed total.
    onNext(withImpliedRoundOff({ ...receipt, items, grand_total: receipt.grand_total || Math.round(computed * 100) / 100 }));
  };

  return (
    <>
      <Paper docket="SCAN" title="The bill">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) scan(f);
          }}
        />
        {!receipt && (
          <>
            <p className="muted">Take a photo of the printed bill or pick a screenshot (Swiggy and Zomato work too). Flat, well-lit photos read best.</p>
            {/* A local blob preview, so next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo && <img src={photo} alt="The bill you picked" className="thumb" />}
            {busy && (
              <p role="status" style={{ color: 'var(--blue)', textAlign: 'center' }}>
                Reading items, taxes and charges… If the numbers don&apos;t add up, it reads the bill again (up to 3 times).
              </p>
            )}
            <Notice lines={error ? [error] : []} tone="error" />
            <button className="btn primary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
              {photo ? 'Try another photo' : 'Photograph or upload the bill'}
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => onReceipt(emptyReceipt())}>
              Type it in instead
            </button>
          </>
        )}
        {receipt && (
          <>
            {unmatched && mustFix && (
              <Notice
                tone="error"
                lines={[
                  `We read the bill ${unmatched} times and the numbers still don't add up. Compare the lines below with the photo and fix them so they match before going on.`,
                ]}
              />
            )}
            <Notice lines={issues.map((i) => `Doesn't add up: ${i}`)} />
            <BillEditor receipt={receipt} onChange={onReceipt} />
            <Rule />
            <button
              className="link"
              type="button"
              onClick={() => {
                onReceipt(null);
                onPhoto(null);
              }}
            >
              Start over with another photo
            </button>
          </>
        )}
      </Paper>
      <div className="actions">
        {receipt && (
          <button
            className="btn primary"
            type="button"
            onClick={continueWith}
            disabled={mustFix || receipt.items.length === 0 || blank.length === receipt.items.length}
          >
            {mustFix ? 'Fix the bill so it adds up' : 'Next: who had what'}
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 2. who had what
function WhoStep({
  receipt,
  photo,
  people,
  meId,
  assignments,
  onChange,
  onItemSplit,
  onBack,
  onNext,
}: {
  receipt: Receipt;
  photo: string | null;
  people: Person[];
  meId: string | null;
  assignments: Assignments;
  onChange: (a: Assignments) => void;
  /** Switching an item between counts/equal and ratio changes the bill line and its shares together. */
  onItemSplit: (r: Receipt, a: Assignments) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ transcript: string; flags: string[] } | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');

  const run = async (input: { audio: Blob } | { transcript: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await assign(input, receipt, people, meId);
      // What it understood fills in; anything it didn't mention keeps your taps. Items given as
      // proportions ("60/40") switch to ratio mode; other mentioned items go back to counts/equal.
      const said = new Set(Object.keys(res.assignments));
      const ratio = new Set(res.ratio ?? []);
      const items = receipt.items.map((i) => {
        if (!said.has(i.id)) return i;
        const next: Receipt['items'][number] = { ...i, split: 'ratio' };
        if (!ratio.has(i.id)) delete next.split;
        return next;
      });
      onItemSplit({ ...receipt, items }, { ...assignments, ...res.assignments });
      setHeard({ transcript: res.transcript, flags: res.flags });
      setTyping(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Picking or unpicking someone re-shares the item equally among whoever's picked (for 3 naans
  // between 2 that's 1½ each); the steppers below fine-tune it.
  const toggle = (item: Receipt['items'][number], pid: string) => {
    const picked = Object.keys(assignments[item.id] ?? {});
    const next = picked.includes(pid) ? picked.filter((id) => id !== pid) : [...picked, pid];
    onChange({ ...assignments, [item.id]: shareEqually(item, next) });
  };
  const setUnits = (itemId: string, pid: string, units: number) => {
    const shares = { ...(assignments[itemId] ?? {}) };
    if (units <= 0) delete shares[pid];
    else shares[pid] = units;
    onChange({ ...assignments, [itemId]: shares });
  };
  const setMode = (item: Receipt['items'][number], ratio: boolean) => {
    const changed: Receipt['items'][number] = { ...item, split: 'ratio' };
    if (!ratio) delete changed.split;
    // Whoever's picked stays picked; the numbers restart from an equal share in the new mode.
    onItemSplit(
      { ...receipt, items: receipt.items.map((i) => (i.id === item.id ? changed : i)) },
      { ...assignments, [item.id]: shareEqually(changed, Object.keys(assignments[item.id] ?? {})) },
    );
  };
  const everyone = people.map((p) => p.id);
  const everyoneOn = (item: Receipt['items'][number]) => onChange({ ...assignments, [item.id]: shareEqually(item, everyone) });
  const splitAllEqually = () => onChange(Object.fromEntries(receipt.items.map((i) => [i.id, shareEqually(i, everyone)])));

  // Not done: nobody picked, or (for counted items) the counts don't add up to the quantity.
  const statusOf = (item: Receipt['items'][number]) => itemStatus(item, assignments[item.id]);
  const left = receipt.items.filter((i) => statusOf(i).kind !== 'done').length;
  const firstNames = people.filter((p) => p.id !== meId).slice(0, 2).map((p) => p.name.split(' ')[0]);

  return (
    <>
      <Paper docket="WHO HAD WHAT" title={receipt.restaurant || 'Who had what'}>
        <p className="muted">Tap the people on each item, or just say it.</p>
        <BillPeek receipt={receipt} photo={photo} />
        <Recorder busy={busy} onClip={(audio) => run({ audio })} />
        {typing ? (
          <div className="stack" style={{ gap: 6 }}>
            <label className="field">
              Who had what
              <textarea
                className="input"
                autoFocus
                maxLength={2000}
                placeholder={`${firstNames[0] ?? 'Ana'} had the biryani, ${firstNames[1] ?? 'Ben'} and I shared the naan…`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            <button className="btn" type="button" disabled={busy || !typed.trim()} onClick={() => run({ transcript: typed })}>
              {busy ? 'Working it out…' : 'Split from text'}
            </button>
          </div>
        ) : (
          <button className="link" type="button" onClick={() => setTyping(true)} style={{ alignSelf: 'center' }}>
            or type it instead
          </button>
        )}
        <Notice lines={error ? [error] : []} tone="error" />
        {heard && (
          <div className="card">
            <p className="muted">Heard:</p>
            <p style={{ fontStyle: 'italic' }}>“{heard.transcript}”</p>
          </div>
        )}
        <Notice lines={heard?.flags ?? []} />

        <div className="row between">
          <h2>Items</h2>
          <button className="link" type="button" onClick={splitAllEqually}>
            Split everything equally
          </button>
        </div>
        {receipt.items.map((item) => {
          const shares = assignments[item.id] ?? {};
          const status = statusOf(item);
          const done = status.kind === 'done';
          return (
            <fieldset key={item.id} className={`card stack${done ? '' : ' todo'}`} style={{ gap: 8, margin: 0 }}>
              <legend className="sr-only">{item.name}</legend>
              <Line label={<strong>{item.qty > 1 ? `${fmtUnits(item.qty)} × ${item.name}` : item.name}</strong>} value={rupees(item.total)} />
              <div className="row wrap" style={{ gap: 6 }}>
                {people.map((p) => (
                  <button key={p.id} type="button" className="chip" aria-pressed={!!shares[p.id]} onClick={() => toggle(item, p.id)}>
                    {p.id === meId ? 'Me' : p.name}
                    {counted(item) && shares[p.id] ? ` ×${fmtUnits(shares[p.id])}` : ''}
                  </button>
                ))}
                {people.length > 2 && (
                  <button type="button" className="link" onClick={() => everyoneOn(item)}>
                    Everyone
                  </button>
                )}
              </div>
              {Object.keys(shares).length > 0 && (item.qty > 1 || Object.keys(shares).length > 1) && (
                <SharesEditor
                  item={item}
                  shares={shares}
                  people={people.filter((p) => shares[p.id])}
                  meId={meId}
                  onUnits={(pid, units) => setUnits(item.id, pid, units)}
                  onRatio={(ratio) => setMode(item, ratio)}
                />
              )}
              <ItemProblem status={status} />
            </fieldset>
          );
        })}
      </Paper>
      <div className="actions">
        <button className="btn primary" type="button" disabled={left > 0} onClick={onNext}>
          {left ? `${left} item${left > 1 ? 's' : ''} not fully assigned` : 'Next: see the split'}
        </button>
        <button className="btn ghost" type="button" onClick={onBack}>
          Back to the bill
        </button>
      </div>
    </>
  );
}

/**
 * How an item is shared between the people picked for it: by count (3 naans: 2 and 1; must add
 * up), equally (one dish), or by ratio (2 : 1, any numbers). The switch flips between them.
 */
function SharesEditor({
  item,
  shares,
  people,
  meId,
  onUnits,
  onRatio,
}: {
  item: Receipt['items'][number];
  shares: Record<string, number>;
  people: Person[];
  meId: string | null;
  onUnits: (pid: string, units: number) => void;
  onRatio: (ratio: boolean) => void;
}) {
  const ratio = item.split === 'ratio';
  const byCount = counted(item);
  const step = byCount ? 0.5 : 1;
  const chip = { minHeight: 34, fontSize: 13 };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" role="group" aria-label={`How ${item.name} is shared`} style={{ gap: 6 }}>
        <button type="button" className="chip" style={chip} aria-pressed={!ratio} onClick={() => ratio && onRatio(false)}>
          {item.qty > 1 ? 'By count' : 'Equally'}
        </button>
        <button type="button" className="chip" style={chip} aria-pressed={ratio} onClick={() => !ratio && onRatio(true)}>
          By ratio
        </button>
      </div>
      <p className="muted">
        {ratio
          ? `Shared in proportion ${people.map((p) => fmtUnits(shares[p.id])).join(' : ')}.`
          : byCount
            ? `How many each? They need to add up to ${fmtUnits(item.qty)}.`
            : 'Shared equally. Switch to ratio for an uneven split.'}
      </p>
      {(ratio || byCount) &&
        people.map((p) => (
          <div key={p.id} className="row between">
            <span>{p.id === meId ? 'Me' : p.name}</span>
            <span className="stepper">
              <button type="button" aria-label={`Less for ${p.name}`} onClick={() => onUnits(p.id, Math.max(0, shares[p.id] - step))}>
                −
              </button>
              <span aria-live="polite">{fmtUnits(shares[p.id])}</span>
              <button type="button" aria-label={`More for ${p.name}`} onClick={() => onUnits(p.id, shares[p.id] + step)}>
                +
              </button>
            </span>
          </div>
        ))}
    </div>
  );
}

/** What's missing on an item: nobody picked yet, or counts that don't add up to the quantity. */
function ItemProblem({ status }: { status: ItemStatus }) {
  if (status.kind === 'done') return null;
  if (status.kind === 'empty') return <p className="muted" style={{ color: 'var(--blue)' }}>Who had this?</p>;
  const gap = Math.abs(status.qty - status.assigned);
  return (
    <p role="status" style={{ color: 'var(--red)', fontSize: 13, fontWeight: 700 }}>
      {fmtUnits(status.assigned)} of {fmtUnits(status.qty)} assigned:{' '}
      {status.kind === 'short' ? `${fmtUnits(gap)} still to give someone` : `${fmtUnits(gap)} too many`}
    </p>
  );
}

/** The bill in view while you say who had what: the photo you uploaded, or the lines you typed. */
function BillPeek({ receipt, photo }: { receipt: Receipt; photo: string | null }) {
  const [zoomed, setZoomed] = useState(false);
  if (photo) {
    return (
      <details open className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32 }}>Your bill</summary>
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          aria-label={zoomed ? 'Show the bill smaller' : 'Show the bill bigger'}
          style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'none', cursor: zoomed ? 'zoom-out' : 'zoom-in', marginTop: 6 }}
        >
          {/* A local data: URL, so next/image has nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="The bill you uploaded" className="thumb" style={zoomed ? { maxHeight: 'none' } : { maxHeight: 260 }} />
        </button>
        <p className="muted">{zoomed ? 'Tap to shrink' : 'Tap to zoom'}</p>
      </details>
    );
  }
  return (
    <details className="card">
      <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32 }}>Your bill ({receipt.items.length} item{receipt.items.length === 1 ? '' : 's'})</summary>
      <div className="stack" style={{ gap: 2, paddingTop: 6 }}>
        {receipt.items.map((i) => (
          <Line key={i.id} label={i.qty > 1 ? `${fmtUnits(i.qty)} × ${i.name}` : i.name} value={rupees(i.total)} />
        ))}
        {[...receipt.charges, ...receipt.taxes].map((a, n) => (
          <Line key={n} label={<span className="muted">{a.name}</span>} value={<span className="muted">{rupees(a.amount)}</span>} />
        ))}
        <Line label="Total" value={rupees(receipt.grand_total)} bold />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- 3. the split
function ResultStep({
  receipt,
  people,
  assignments,
  title,
  onTitle,
  onBack,
  onSave,
}: {
  receipt: Receipt;
  people: Person[];
  assignments: Assignments;
  title: string;
  onTitle: (t: string) => void;
  onBack: () => void;
  onSave: (r: SplitResult) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  let result: SplitResult | null = null;
  let splitError: string | null = null;
  try {
    // Only people who had something get a line.
    const involved = people.filter((p) => receipt.items.some((i) => assignments[i.id]?.[p.id]));
    result = splitBill(receipt, involved, assignments);
  } catch (e) {
    splitError = e instanceof SplitError || e instanceof Error ? e.message : String(e);
  }

  const save = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <>
      <Paper docket="DRAFT" title="Who pays what">
        <label className="field">
          Name this split
          <input className="input" maxLength={120} placeholder="Dinner at…" value={title} onChange={(e) => onTitle(e.target.value)} />
        </label>
        <Notice lines={splitError ? [splitError] : []} tone="error" />
        {result && <SplitLines result={result} />}
        <Notice lines={error ? [error] : []} tone="error" />
      </Paper>
      <div className="actions">
        <button className="btn primary" type="button" disabled={!result || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save split'}
        </button>
        <button className="btn ghost" type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}

/** Everyone's share with a copy button (for pasting into GPay), and the breakdown. */
export function SplitLines({ result }: { result: SplitResult }) {
  const [toast, show] = useToast();
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      show(`Copied ${what}`);
    } catch {
      show("Couldn't copy. Select the amount instead.");
    }
  };
  return (
    <div className="stack">
      <Rule double />
      {result.people.map((p) => (
        <div key={p.person_id} className="stack" style={{ gap: 2 }}>
          <div className="row">
            <div className="grow">
              <Line label={<strong>{p.name}</strong>} value={<strong>{rupees(p.total)}</strong>} />
            </div>
            <button type="button" className="btn small" onClick={() => copy(plainAmount(p.total), `${p.name}'s ${rupees(p.total)}`)} aria-label={`Copy ${p.name}'s amount`}>
              Copy
            </button>
          </div>
          <details>
            <summary className="muted" style={{ cursor: 'pointer', minHeight: 32 }}>
              items {rupees(p.items_subtotal)} + taxes &amp; charges {rupees(p.extras)}
            </summary>
            <div className="stack" style={{ gap: 2, padding: '4px 0 4px 10px' }}>
              {p.items.map((i) => (
                <Line key={i.item_id} label={<span className="muted">{i.name}</span>} value={<span className="muted">{rupees(i.amount)}</span>} />
              ))}
            </div>
          </details>
        </div>
      ))}
      <Rule double />
      <Line label="Total" value={rupees(result.bill_total)} bold />
      <Notice lines={result.warnings} />
      {toast}
    </div>
  );
}

// ---------------------------------------------------------------- unsaved drafts
function readDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, d: Draft) {
  try {
    sessionStorage.setItem(key, JSON.stringify(d));
  } catch {}
}
function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
