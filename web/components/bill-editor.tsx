'use client';

import { useRef } from 'react';

import type { Adjustment, Item, Receipt } from '@/lib/types';

let next = 0;
export const newItemId = () => `n${Date.now().toString(36)}${next++}`;

export const emptyReceipt = (): Receipt => ({
  restaurant: null,
  items: [{ id: newItemId(), name: '', qty: 1, unit_price: null, total: 0, tax_class: 'food' }],
  charges: [],
  taxes: [],
  round_off: 0,
  subtotal: null,
  grand_total: 0,
});

/**
 * A number field that keeps what you type ("1." while typing 1.5) and reports numbers.
 * `signed` adds a ± button: the iPhone number pad has no minus key, and round-offs and
 * discounts are often negative.
 */
function Num({
  value,
  onChange,
  label,
  step = 'any',
  width = 96,
  signed,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  step?: string;
  width?: number;
  signed?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const field = (
    <input
      ref={input}
      className="input num"
      style={{ width }}
      type="number"
      inputMode="decimal"
      step={step}
      aria-label={label}
      defaultValue={value === 0 ? '' : value}
      placeholder="0"
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
  if (!signed) return field;
  const flip = () => {
    const flipped = -value;
    onChange(flipped);
    if (input.current) input.current.value = flipped === 0 ? '' : String(flipped);
  };
  return (
    <span className="row" style={{ gap: 4 }}>
      <button
        type="button"
        className="btn small"
        style={{ minWidth: 40, padding: '6px 8px' }}
        onClick={flip}
        aria-label={`Make ${label.toLowerCase()} ${value < 0 ? 'positive' : 'negative'}`}
      >
        ±
      </button>
      {field}
    </span>
  );
}

/** Every line of the bill, editable: fix a misread, add what's missing, delete what's wrong. */
export function BillEditor({ receipt, onChange }: { receipt: Receipt; onChange: (r: Receipt) => void }) {
  const setItem = (id: string, patch: Partial<Item>) =>
    onChange({ ...receipt, items: receipt.items.map((i) => (i.id === id ? { ...i, ...patch, unit_price: null } : i)) });
  // Charges and taxes are shared the same way, so they're edited as one list.
  const extras = [...receipt.charges.map((a) => ({ ...a, kind: 'charges' as const })), ...receipt.taxes.map((a) => ({ ...a, kind: 'taxes' as const }))];
  const plain = ({ name, amount, applies_to }: Adjustment): Adjustment => ({ name, amount, applies_to });
  const setExtras = (list: (Adjustment & { kind: 'charges' | 'taxes' })[]) =>
    onChange({
      ...receipt,
      charges: list.filter((x) => x.kind === 'charges').map(plain),
      taxes: list.filter((x) => x.kind === 'taxes').map(plain),
    });

  return (
    <div className="stack">
      <label className="field">
        Place
        <input
          className="input"
          maxLength={120}
          placeholder="Restaurant or shop"
          value={receipt.restaurant ?? ''}
          onChange={(e) => onChange({ ...receipt, restaurant: e.target.value || null })}
        />
      </label>

      <h2>Items</h2>
      {receipt.items.map((item, n) => (
        <div key={item.id} className="card stack" style={{ gap: 6, padding: 10 }}>
          <div className="row">
            <input
              className="input grow"
              aria-label={`Item ${n + 1} name`}
              placeholder="What was it?"
              maxLength={120}
              defaultValue={item.name}
              onChange={(e) => setItem(item.id, { name: e.target.value })}
            />
            <button
              type="button"
              className="link danger"
              aria-label={`Delete ${item.name || `item ${n + 1}`}`}
              onClick={() => onChange({ ...receipt, items: receipt.items.filter((i) => i.id !== item.id) })}
            >
              Delete
            </button>
          </div>
          <div className="row between">
            <label className="row muted" style={{ gap: 6 }}>
              Qty <Num label={`Item ${n + 1} quantity`} value={item.qty} width={64} onChange={(qty) => setItem(item.id, { qty: qty > 0 ? qty : 1 })} />
            </label>
            <label className="row muted" style={{ gap: 6 }}>
              ₹ <Num label={`Item ${n + 1} amount`} value={item.total} onChange={(total) => setItem(item.id, { total })} />
            </label>
          </div>
          <label className="row muted" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={item.tax_class === 'alcohol'}
              onChange={(e) => setItem(item.id, { tax_class: e.target.checked ? 'alcohol' : 'food' })}
            />
            Alcohol (taxed with VAT, not GST)
          </label>
        </div>
      ))}
      <button
        type="button"
        className="btn small"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange({ ...receipt, items: [...receipt.items, { id: newItemId(), name: '', qty: 1, unit_price: null, total: 0, tax_class: 'food' }] })}
      >
        + Add item
      </button>

      <h2>Taxes, charges, discounts</h2>
      <p className="muted">Shared in proportion to what each person had. For a discount, tap ± to make the amount negative.</p>
      {extras.map((x, n) => (
        <div key={`${x.kind}-${n}-${extras.length}`} className="card stack" style={{ gap: 6, padding: 10 }}>
          <div className="row">
            <input
              className="input grow"
              aria-label={`Charge ${n + 1} name`}
              placeholder="CGST 2.5%, Service charge…"
              defaultValue={x.name}
              maxLength={80}
              onChange={(e) => setExtras(extras.map((y, i) => (i === n ? { ...y, name: e.target.value } : y)))}
            />
            <button type="button" className="link danger" onClick={() => setExtras(extras.filter((_, i) => i !== n))}>
              Delete
            </button>
          </div>
          <div className="row between">
            <select
              className="input grow"
              aria-label={`Who charge ${n + 1} applies to`}
              value={x.applies_to}
              onChange={(e) => setExtras(extras.map((y, i) => (i === n ? { ...y, applies_to: e.target.value } : y)))}
            >
              <option value="all">Everything</option>
              <option value="food">Food (GST)</option>
              <option value="alcohol">Alcohol (VAT)</option>
            </select>
            <label className="row muted" style={{ gap: 6, flex: 'none' }}>
              ₹ <Num signed label={`Charge ${n + 1} amount`} value={x.amount} onChange={(amount) => setExtras(extras.map((y, i) => (i === n ? { ...y, amount } : y)))} />
            </label>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn small"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setExtras([...extras, { name: '', amount: 0, applies_to: 'all', kind: 'charges' }])}
      >
        + Add tax or charge
      </button>

      <div className="row between">
        <span className="muted">Round off</span>
        <Num signed label="Round off" value={receipt.round_off} onChange={(round_off) => onChange({ ...receipt, round_off })} />
      </div>
      {receipt.subtotal != null && (
        <div className="row between">
          <span className="muted">Subtotal on the bill</span>
          <Num label="Subtotal" value={receipt.subtotal} onChange={(subtotal) => onChange({ ...receipt, subtotal })} />
        </div>
      )}
      <div className="row between">
        <strong>Grand total on the bill</strong>
        <Num label="Grand total" value={receipt.grand_total} onChange={(grand_total) => onChange({ ...receipt, grand_total })} />
      </div>
    </div>
  );
}
