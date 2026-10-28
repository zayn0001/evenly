// Sanity checks on a scanned bill. Catches most misreads by the vision models.
import type { Receipt } from './types.ts';

const TOLERANCE = 1; // rupees; bills round individual lines

const r2 = (n: number) => n.toFixed(2);

export function reconcile(r: Receipt): string[] {
  const issues: string[] = [];
  for (const item of r.items) {
    if (item.unit_price != null && Math.abs(item.unit_price * item.qty - item.total) > TOLERANCE) {
      issues.push(`${item.name}: ${item.qty} × ₹${item.unit_price} ≠ ₹${item.total}`);
    }
  }
  const itemsSum = r.items.reduce((t, i) => t + i.total, 0);
  if (r.subtotal != null && Math.abs(itemsSum - r.subtotal) > TOLERANCE) {
    issues.push(`Items add up to ₹${r2(itemsSum)} but the subtotal is ₹${r2(r.subtotal)}`);
  }
  const extras = [...r.charges, ...r.taxes].reduce((t, a) => t + a.amount, 0);
  const computed = itemsSum + extras + r.round_off;
  if (Math.abs(computed - r.grand_total) > TOLERANCE) {
    issues.push(`Items + charges + taxes + round-off = ₹${r2(computed)}, but the grand total is ₹${r2(r.grand_total)}`);
  }
  return issues;
}

/**
 * Many bills round the total without printing a round-off line (lines 715.02, "Net Amount 715.00").
 * When there's no round-off and the lines miss the printed total by under ₹1, that gap is the
 * round-off; filling it in makes the numbers match exactly and the split use the printed total.
 */
export function withImpliedRoundOff(r: Receipt): Receipt {
  if (r.round_off !== 0 || !r.grand_total) return r;
  const lines = r.items.reduce((t, i) => t + i.total, 0) + [...r.charges, ...r.taxes].reduce((t, a) => t + a.amount, 0);
  const gap = Math.round((r.grand_total - lines) * 100) / 100;
  return gap !== 0 && Math.abs(gap) < TOLERANCE ? { ...r, round_off: gap } : r;
}
