// Sanity checks on a scanned bill. Catches most misreads by the vision models.
import type { Receipt } from './types.ts';

export const TOLERANCE = 1; // rupees; bills round individual lines

const r2 = (n: number) => n.toFixed(2);

/**
 * `tolerance` is for the grand total: TOLERANCE for a scanned bill, 0 for one typed in by hand.
 * The slack is only for a bill that rounds without printing a round-off (withImpliedRoundOff
 * fills it in); with a printed round-off the lines must hit the total exactly.
 */
export function reconcile(r: Receipt, tolerance = TOLERANCE): string[] {
  if (r.round_off) tolerance = 0;
  const issues: string[] = [];
  for (const item of r.items) {
    if (item.unit_price != null && Math.abs(item.unit_price * item.qty - item.total) > TOLERANCE) {
      issues.push(`${item.name}: ${item.qty} × ₹${item.unit_price} ≠ ₹${item.total}`);
    }
  }
  const itemsSum = r.items.reduce((t, i) => t + i.total, 0);
  const extras = [...r.charges, ...r.taxes].reduce((t, a) => t + a.amount, 0);
  const computed = itemsSum + extras + r.round_off;
  if (Math.abs(Math.round((computed - r.grand_total) * 100) / 100) > tolerance) {
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
