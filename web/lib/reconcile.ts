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
