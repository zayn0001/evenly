// The text shared from a saved split: by item (who shared each dish) or by person (what each had).
import { counted } from './assign.ts';
import { fmtUnits, rupees } from './format.ts';
import type { Assignments, Item, Receipt, SplitResult } from './types.ts';

type Shared = { title: string; total: number; receipt: Receipt; assignments: Assignments; result: SplitResult };

/** How an item was divided: by count (2 of 3), equally (7 ways) or by weight (2 : 1). */
function how(item: Item, shares: Record<string, number>) {
  const units = Object.values(shares).filter((u) => u > 0);
  if (counted(item)) return 'count';
  return item.split !== 'ratio' && new Set(units).size === 1 ? 'equal' : 'ratio';
}

const amountOf = (s: Shared, personId: string, itemId: string) =>
  s.result.people.find((p) => p.person_id === personId)?.items.find((i) => i.item_id === itemId)?.amount ?? 0;

export function shareByItem(s: Shared): string {
  const blocks = s.receipt.items.map((item) => {
    const shares = s.assignments[item.id] ?? {};
    const people = s.result.people.filter((p) => shares[p.person_id] > 0);
    const kind = how(item, shares);
    const head =
      kind === 'count'
        ? `${fmtUnits(item.qty)} × ${item.name}: ${rupees(item.total)}`
        : kind === 'equal'
          ? `${item.name}: ${rupees(item.total)}${people.length > 1 ? `, split ${people.length} ways` : ''}`
          : `${item.name}: ${rupees(item.total)}, by ratio ${people.map((p) => fmtUnits(shares[p.person_id])).join(' : ')}`;
    const lines = people.map((p) => {
      const u = fmtUnits(shares[p.person_id]);
      const tag = kind === 'count' ? ` ×${u}` : kind === 'ratio' ? ` (${u})` : '';
      return `- ${p.name}${tag}: ${rupees(amountOf(s, p.person_id, item.id))}`;
    });
    return [head, ...lines].join('\n');
  });
  const totals = s.result.people.filter((p) => p.total).map((p) => `${p.name}: ${rupees(p.total)}`);
  return [`${s.title}: ${rupees(s.total)}`, ...blocks, ['Each pays (with taxes & charges)', ...totals].join('\n')].join('\n\n');
}

export function shareByPerson(s: Shared): string {
  const blocks = s.result.people
    .filter((p) => p.total)
    .map((p) => {
      const lines = p.items.map((line) => {
        const item = s.receipt.items.find((i) => i.id === line.item_id);
        const shares = s.assignments[line.item_id] ?? {};
        const u = shares[p.person_id] ?? 0;
        const n = Object.values(shares).filter((x) => x > 0).length;
        const kind = item ? how(item, shares) : 'equal';
        const part =
          kind === 'count'
            ? `, ${fmtUnits(u)} of ${fmtUnits(item!.qty)}`
            : kind === 'ratio'
              ? `, ${fmtUnits(u)} of ${fmtUnits(Object.values(shares).reduce((t, x) => t + (x > 0 ? x : 0), 0))} parts`
              : n > 1
                ? `, split ${n} ways`
                : '';
        return `- ${line.name}${part}: ${rupees(line.amount)}`;
      });
      if (p.extras) lines.push(`- Taxes & charges: ${rupees(p.extras)}`);
      return [`${p.name}: ${rupees(p.total)}`, ...lines].join('\n');
    });
  return [`${s.title}: ${rupees(s.total)}`, ...blocks].join('\n\n');
}
