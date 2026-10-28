// Whether an item's "who had what" is complete.
// An item with a quantity above 1 (3 naans) is counted: everyone's units must add up to the
// quantity. Anything else (1 dish, 0.58 kg of onions), or any item switched to a ratio (2 : 1),
// is shared by weight, so any selection is fine.
import type { Item } from './types.ts';

export type ItemStatus =
  | { kind: 'empty' }
  | { kind: 'done' }
  | { kind: 'short' | 'over'; assigned: number; qty: number };

export const counted = (item: Pick<Item, 'qty' | 'split'>) => item.qty > 1 && item.split !== 'ratio';

export function itemStatus(item: Pick<Item, 'qty' | 'split'>, shares: Record<string, number> = {}): ItemStatus {
  const assigned = Object.values(shares).reduce((t, u) => t + (u > 0 ? u : 0), 0);
  if (assigned === 0) return { kind: 'empty' };
  if (!counted(item)) return { kind: 'done' };
  const diff = assigned - item.qty;
  if (Math.abs(diff) < 1e-6) return { kind: 'done' }; // thirds (1/3 + 1/3 + 1/3) aren't exact floats
  return { kind: diff < 0 ? 'short' : 'over', assigned, qty: item.qty };
}

/** The item shared equally by these people: whole quantity spread evenly when it's counted, 1 : 1 otherwise. */
export function shareEqually(item: Pick<Item, 'qty' | 'split'>, personIds: string[]): Record<string, number> {
  const each = counted(item) ? item.qty / personIds.length : 1;
  return Object.fromEntries(personIds.map((id) => [id, each]));
}
