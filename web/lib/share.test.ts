import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shareByItem, shareByPerson } from './share.ts';
import { splitBill } from './split.ts';
import type { Assignments, Receipt } from './types.ts';

const receipt: Receipt = {
  restaurant: null,
  items: [
    { id: 'naan', name: 'Naan', qty: 3, unit_price: 30, total: 90, tax_class: 'food' },
    { id: 'paneer', name: 'Paneer', qty: 1, unit_price: null, total: 210, tax_class: 'food' },
    { id: 'meals', name: 'Meals', qty: 1, unit_price: null, total: 300, tax_class: 'food', split: 'ratio' },
  ],
  charges: [],
  taxes: [{ name: 'GST', amount: 30, applies_to: 'all' }],
  round_off: 0,
  grand_total: 630,
};
const people = [
  { id: 'a', name: 'Asha' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Chitra' },
];
const assignments: Assignments = { naan: { a: 2, b: 1 }, paneer: { a: 1, b: 1, c: 1 }, meals: { a: 2, c: 1 } };
const shared = { title: 'Dinner', total: 630, receipt, assignments, result: splitBill(receipt, people, assignments) };

test('sharing by item shows who had each dish and how it was divided', () => {
  const text = shareByItem(shared);
  assert.ok(text.includes('3 × Naan: ₹90.00\n- Asha ×2: ₹60.00\n- Ben ×1: ₹30.00'), text);
  assert.ok(text.includes('Paneer: ₹210.00, split 3 ways\n- Asha: ₹70.00'), text);
  assert.ok(text.includes('Meals: ₹300.00, by ratio 2 : 1\n- Asha (2): ₹200.00\n- Chitra (1): ₹100.00'), text);
  assert.ok(text.includes('Each pays (with taxes & charges)\nAsha: ₹346.50'), text);
});

test('sharing by person shows what each had and their portion', () => {
  const text = shareByPerson(shared);
  assert.ok(text.startsWith('Dinner: ₹630.00\n\nAsha: ₹346.50'), text);
  assert.ok(text.includes('- Naan, 2 of 3: ₹60.00'), text);
  assert.ok(text.includes('- Paneer, split 3 ways: ₹70.00'), text);
  assert.ok(text.includes('- Meals, 2 of 3 parts: ₹200.00'), text);
  assert.ok(text.includes('- Taxes & charges: ₹16.50'), text);
});
