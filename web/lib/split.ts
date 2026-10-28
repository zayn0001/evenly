// Pure split engine: receipt + assignments in, per-person totals out. No AI, no I/O.
//
// All arithmetic is exact (paise as fractions of BigInts). Final per-person amounts are rounded
// to whole paise with the largest-remainder method, so they always add up to the bill exactly.
import type { Assignments, Person, PersonTotal, Receipt, SplitResult } from './types.ts';

export class SplitError extends Error {}

// ---------------------------------------------------------------- exact fractions
type Q = { n: bigint; d: bigint }; // d > 0, reduced

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};
const q = (n: bigint, d = 1n): Q => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const ZERO = q(0n);
const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
const eq = (a: Q, b: Q) => a.n === b.n && a.d === b.d;
const isZero = (a: Q) => a.n === 0n;
const floor = (a: Q) => (a.n >= 0n ? a.n / a.d : -((-a.n + a.d - 1n) / a.d));
const toNumber = (a: Q) => Number(a.n) / Number(a.d);
const sum = (xs: Iterable<Q>) => [...xs].reduce(add, ZERO);

/** Closest fraction with a denominator ≤ maxDen (like Python's limit_denominator). 1/3 stays 1/3. */
export function rational(x: number, maxDen = 1000): Q {
  if (Number.isInteger(x)) return q(BigInt(x));
  let [p0, q0, p1, q1] = [0n, 1n, 1n, 0n];
  let rest = x;
  for (let i = 0; i < 64; i++) {
    const a = BigInt(Math.floor(rest));
    const q2 = q0 + a * q1;
    if (q2 > BigInt(maxDen)) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    const frac = rest - Math.floor(rest);
    if (frac < 1e-12) break;
    rest = 1 / frac;
  }
  return q(p1, q1);
}

// ---------------------------------------------------------------- money
export const toPaise = (rupees: number) => Math.round(rupees * 100);
const fromPaise = (paise: Q | number) => Math.round(typeof paise === 'number' ? paise : toNumber(paise)) / 100;

function proportional(amount: number, base: Map<string, Q>): Map<string, Q> {
  const total = sum(base.values());
  return new Map([...base].map(([pid, w]) => [pid, div(mul(q(BigInt(amount)), w), total)]));
}

/** Rounds exact amounts to whole numbers that add up to `target`. */
export function largestRemainder(exact: Map<string, Q>, target: number): Map<string, number> {
  const floors = new Map([...exact].map(([k, v]) => [k, Number(floor(v))]));
  let leftover = target - [...floors.values()].reduce((a, b) => a + b, 0);
  // Biggest fractional parts get the spare paise first; ties broken by key for determinism.
  const fracOf = (k: string) => toNumber(add(exact.get(k)!, q(-BigInt(floors.get(k)!))));
  const order = [...exact.keys()].sort((a, b) => fracOf(b) - fracOf(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const k of order) {
    if (leftover <= 0) break;
    floors.set(k, floors.get(k)! + 1);
    leftover--;
  }
  return floors;
}

export function splitBill(receipt: Receipt, people: Person[], assignments: Assignments): SplitResult {
  const personIds = new Set(people.map((p) => p.id));
  if (personIds.size === 0) throw new SplitError('No people to split between');
  const warnings: string[] = [];

  const itemShare = new Map<string, Map<string, Q>>(); // item -> person -> paise
  const allBase = new Map<string, Q>();
  const classBase = new Map<string, Map<string, Q>>();
  const bump = (m: Map<string, Q>, k: string, v: Q) => m.set(k, add(m.get(k) ?? ZERO, v));

  for (const item of receipt.items) {
    const shares = Object.entries(assignments[item.id] ?? {}).filter(([, u]) => u > 0);
    const unknown = shares.map(([pid]) => pid).filter((pid) => !personIds.has(pid));
    if (unknown.length) throw new SplitError(`${item.name}: unknown people ${unknown.sort().join(', ')}`);
    if (shares.length === 0) throw new SplitError(`Nobody is assigned to '${item.name}'`);

    const weights = new Map<string, Q>();
    for (const [pid, units] of shares) bump(weights, pid, rational(units));
    const totalUnits = sum(weights.values());
    if (item.qty > 1 && item.split !== 'ratio' && !eq(totalUnits, rational(item.qty))) {
      warnings.push(`${item.name}: ${+toNumber(totalUnits).toFixed(3)} of ${item.qty} units assigned; split proportionally`);
    }

    const paise = q(BigInt(toPaise(item.total)));
    const perPerson = new Map([...weights].map(([pid, w]) => [pid, div(mul(paise, w), totalUnits)]));
    itemShare.set(item.id, perPerson);
    if (!classBase.has(item.tax_class)) classBase.set(item.tax_class, new Map());
    for (const [pid, amt] of perPerson) {
      bump(allBase, pid, amt);
      bump(classBase.get(item.tax_class)!, pid, amt);
    }
  }

  const exact = new Map<string, Q>(people.map((p) => [p.id, allBase.get(p.id) ?? ZERO]));
  let target = receipt.items.reduce((t, i) => t + toPaise(i.total), 0);

  for (const adj of [...receipt.charges, ...receipt.taxes]) {
    const amount = toPaise(adj.amount);
    target += amount;
    let base = adj.applies_to === 'all' ? allBase : classBase.get(adj.applies_to);
    if (!base || isZero(sum(base.values()))) {
      if (adj.applies_to !== 'all') warnings.push(`${adj.name}: no '${adj.applies_to}' items found; split over everything`);
      base = allBase;
    }
    if (isZero(sum(base.values()))) throw new SplitError(`Can't share ${adj.name}: the bill has no item value`);
    for (const [pid, amt] of proportional(amount, base)) bump(exact, pid, amt);
  }

  const roundOff = toPaise(receipt.round_off);
  if (roundOff) {
    target += roundOff;
    const before = new Map([...exact].filter(([, v]) => !isZero(v)));
    for (const [pid, amt] of proportional(roundOff, before)) bump(exact, pid, amt);
  }

  if (target !== toPaise(receipt.grand_total)) {
    warnings.push(
      `Line items add up to ₹${fromPaise(target).toFixed(2)} but the bill says ₹${receipt.grand_total.toFixed(2)}; the split uses the line items`,
    );
  }

  const final = largestRemainder(exact, target);
  const result: PersonTotal[] = people.map((person) => {
    const lines = receipt.items
      .filter((item) => itemShare.get(item.id)!.has(person.id))
      .map((item) => ({ item_id: item.id, name: item.name, amount: fromPaise(itemShare.get(item.id)!.get(person.id)!) }));
    const itemsSubtotal = fromPaise(allBase.get(person.id) ?? ZERO);
    const total = fromPaise(final.get(person.id)!);
    return {
      person_id: person.id,
      name: person.name,
      items: lines,
      items_subtotal: itemsSubtotal,
      extras: Math.round((total - itemsSubtotal) * 100) / 100,
      total,
    };
  });
  return { people: result, bill_total: fromPaise(target), warnings };
}
