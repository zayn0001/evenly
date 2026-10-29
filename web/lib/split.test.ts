import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reconcile, withImpliedRoundOff } from './reconcile.ts';
import { largestRemainder, rational, SplitError, splitBill } from './split.ts';
import type { Assignments, Receipt, SplitResult } from './types.ts';

/** A realistic bill: GST on food, VAT on the beer, service charge on everything, round-off. */
const BILL: Receipt = {
  restaurant: 'Punjab Grill',
  items: [
    { id: 'i1', name: 'Butter Chicken', qty: 1, unit_price: 380, total: 380, tax_class: 'food' },
    { id: 'i2', name: 'Lamb Rogan Josh', qty: 1, unit_price: 450, total: 450, tax_class: 'food' },
    { id: 'i3', name: 'Butter Naan', qty: 6, unit_price: 60, total: 360, tax_class: 'food' },
    { id: 'i4', name: 'Tandoori Roti', qty: 1, unit_price: 45, total: 45, tax_class: 'food' },
    { id: 'i5', name: 'Kingfisher Beer', qty: 2, unit_price: 250, total: 500, tax_class: 'alcohol' },
  ],
  charges: [{ name: 'Service Charge 5%', amount: 86.75, applies_to: 'all' }],
  taxes: [
    { name: 'CGST 2.5%', amount: 30.88, applies_to: 'food' },
    { name: 'SGST 2.5%', amount: 30.88, applies_to: 'food' },
    { name: 'VAT 18%', amount: 90, applies_to: 'alcohol' },
  ],
  round_off: -0.51,
  grand_total: 1973,
};
const PEOPLE = [
  { id: 'me', name: 'Me' },
  { id: 's', name: 'Sruthi' },
  { id: 'j', name: 'Janet' },
];
// "Janet and I had the butter chicken, Sruthi the lamb, 2 naans each, Sruthi and I split a roti, Janet and I a beer each"
const SAID: Assignments = {
  i1: { me: 1, j: 1 },
  i2: { s: 1 },
  i3: { me: 2, s: 2, j: 2 },
  i4: { me: 0.5, s: 0.5 },
  i5: { me: 1, j: 1 },
};
const byId = (r: SplitResult) => Object.fromEntries(r.people.map((p) => [p.person_id, p]));
const total = (r: SplitResult) => Math.round(r.people.reduce((t, p) => t + p.total, 0) * 100) / 100;

test('the sample bill adds up', () => assert.deepEqual(reconcile(BILL), []));

test('shares add up exactly to the grand total', () => {
  const r = splitBill(BILL, PEOPLE, SAID);
  assert.equal(total(r), 1973);
  assert.deepEqual(r.warnings, []);
});

test('items go to the right people', () => {
  const p = byId(splitBill(BILL, PEOPLE, SAID));
  assert.equal(p.me.items_subtotal, 582.5); // half butter chicken 190 + 2 naan 120 + half roti 22.5 + beer 250
  assert.equal(p.s.items_subtotal, 592.5); // lamb 450 + 2 naan 120 + half roti 22.5
  assert.equal(p.j.items_subtotal, 560); // half butter chicken 190 + 2 naan 120 + beer 250
});

test('VAT only lands on the people who drank', () => {
  const bill = { ...BILL, charges: [], round_off: 0, grand_total: 1886.76 };
  const p = byId(splitBill(bill, PEOPLE, SAID));
  const food = { me: 332.5, s: 592.5, j: 310 } as const;
  for (const [pid, f] of Object.entries(food)) {
    const expected = (61.76 * f) / 1235 + (pid === 's' ? 0 : 45);
    assert.ok(Math.abs(p[pid].extras - expected) <= 0.01, `${pid}: ${p[pid].extras} vs ${expected}`);
  }
});

test('an odd amount split three ways loses no paisa', () => {
  const bill: Receipt = { ...BILL, items: [{ id: 'x', name: 'Thali', qty: 1, unit_price: null, total: 100, tax_class: 'food' }], charges: [], taxes: [], round_off: 0, grand_total: 100 };
  const r = splitBill(bill, PEOPLE, { x: { me: 1, s: 1, j: 1 } });
  assert.deepEqual(r.people.map((p) => p.total).sort(), [33.33, 33.33, 33.34]);
});

test('thirds from "split equally" on a qty-2 item count as the whole item (no warning)', () => {
  const bill: Receipt = { ...BILL, items: [{ id: 'x', name: 'Pizza', qty: 2, unit_price: null, total: 600, tax_class: 'food' }], charges: [], taxes: [], round_off: 0, grand_total: 600 };
  const r = splitBill(bill, PEOPLE, { x: { me: 2 / 3, s: 2 / 3, j: 2 / 3 } });
  assert.deepEqual(r.warnings, []);
  assert.equal(total(r), 600);
});

test('an unassigned item is an error', () => {
  const rest = { ...SAID };
  delete rest.i2;
  assert.throws(() => splitBill(BILL, PEOPLE, rest), (e: unknown) => e instanceof SplitError && /Nobody is assigned/.test(e.message));
});

test('an unknown person is an error', () => {
  assert.throws(() => splitBill(BILL, PEOPLE, { ...SAID, i2: { ghost: 1 } }), /unknown/);
});

test('partly assigned quantities warn and split proportionally', () => {
  const r = splitBill(BILL, PEOPLE, { ...SAID, i3: { me: 2, s: 2 } });
  assert.ok(r.warnings.some((w) => w.includes('Butter Naan')));
  assert.equal(total(r), 1973);
});

test('a discount lowers everyone’s share', () => {
  const discounted = { ...BILL, charges: [...BILL.charges, { name: 'Discount', amount: -100, applies_to: 'all' }], grand_total: 1873 };
  const before = byId(splitBill(BILL, PEOPLE, SAID));
  const after = byId(splitBill(discounted, PEOPLE, SAID));
  for (const pid of ['me', 's', 'j']) assert.ok(after[pid].total < before[pid].total);
  assert.equal(total(splitBill(discounted, PEOPLE, SAID)), 1873);
});

test('a grand total that disagrees with the lines warns', () => {
  assert.ok(splitBill({ ...BILL, grand_total: 2000 }, PEOPLE, SAID).warnings.some((w) => w.includes('the bill says')));
});

test('largest remainder hands out the spare paisa', () => {
  const third = rational(10 / 3);
  assert.deepEqual([...largestRemainder(new Map([['a', third], ['b', third], ['c', third]]), 10).values()].sort(), [3, 3, 4]);
});

test('rational() finds simple fractions', () => {
  assert.deepEqual(rational(0.5), { n: 1n, d: 2n });
  assert.deepEqual(rational(2 / 3), { n: 2n, d: 3n });
  assert.deepEqual(rational(0.333), { n: 333n, d: 1000n });
});

test('reconcile flags a misread total', () => {
  assert.ok(reconcile({ ...BILL, grand_total: 2500 }).some((i) => i.includes('grand total')));
});

test('a typed-in bill has to hit its total exactly', () => {
  const off = { ...BILL, round_off: 0, grand_total: BILL.grand_total + 0.51 + 0.5 };
  assert.deepEqual(reconcile(off), []);
  assert.equal(reconcile(off, 0).length, 1);
  assert.deepEqual(reconcile(BILL, 0), []);
});

test('a scanned bill with a printed round-off has to hit its total exactly', () => {
  assert.equal(reconcile({ ...BILL, grand_total: BILL.grand_total + 0.05 }).length, 1);
});

test('a total rounded without a round-off line gets one, so the split matches the printed total', () => {
  // A real bill: lines add up to 715.02, "Net Amount: 715.00", no round-off printed.
  const bill: Receipt = {
    restaurant: null,
    items: [
      { id: 'i1', name: 'Mushroom Biriyani', qty: 3, unit_price: 94.29, total: 282.87, tax_class: 'food' },
      { id: 'i2', name: 'Mushroom Fried Rice', qty: 2, unit_price: 109.52, total: 219.04, tax_class: 'food' },
      { id: 'i3', name: 'Paneer 65', qty: 1, unit_price: 84.76, total: 84.76, tax_class: 'food' },
      { id: 'i4', name: 'Meals', qty: 1, unit_price: 94.29, total: 94.29, tax_class: 'food' },
    ],
    charges: [],
    taxes: [
      { name: 'CGST 2.5%', amount: 17.03, applies_to: 'food' },
      { name: 'SGST 2.5%', amount: 17.03, applies_to: 'food' },
    ],
    round_off: 0,
    grand_total: 715,
  };
  const fixed = withImpliedRoundOff(bill);
  assert.equal(fixed.round_off, -0.02);
  const r = splitBill(fixed, PEOPLE, { i1: { me: 1, s: 1, j: 1 }, i2: { me: 1, s: 1 }, i3: { j: 1 }, i4: { s: 1 } });
  assert.equal(r.bill_total, 715);
  assert.equal(total(r), 715);
  assert.deepEqual(r.warnings, []);
  // Not touched: a printed round-off, an exact match, or a gap of ₹1 or more (a misread, not rounding).
  assert.equal(withImpliedRoundOff({ ...bill, round_off: -0.5 }).round_off, -0.5);
  assert.equal(withImpliedRoundOff({ ...bill, grand_total: 715.02 }).round_off, 0);
  assert.equal(withImpliedRoundOff({ ...bill, grand_total: 720 }).round_off, 0);
});

test('an item switched to a ratio splits by proportion, whatever the quantity', () => {
  const bill: Receipt = {
    restaurant: null,
    items: [{ id: 'a', name: 'Apples', qty: 3, unit_price: 100, total: 300, tax_class: 'food', split: 'ratio' }],
    charges: [],
    taxes: [],
    round_off: 0,
    grand_total: 300,
  };
  const r = splitBill(bill, PEOPLE.slice(0, 2), { a: { me: 2, s: 1 } });
  assert.deepEqual(r.people.map((p) => p.total), [200, 100]);
  assert.deepEqual(r.warnings, []); // 2 + 1 = 3 is a coincidence; ratios aren't counts, so no "units" check
});
