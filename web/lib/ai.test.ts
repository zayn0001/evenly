import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AIError, extractReceipt, parseJson, parseReceipt, sanitizeAssignments } from './ai.ts';
import type { Receipt } from './types.ts';

const GOOD: Receipt = parseReceipt({
  restaurant: 'Cafe',
  items: [{ name: 'Waffle', qty: 1, unit_price: 149, total: 149 }, { name: 'Shake', total: '₹210' }],
  taxes: [{ name: 'GST', amount: 17.95, applies_to: 'food' }],
  round_off: 0.05,
  grand_total: 377,
});
const BAD = { ...GOOD, grand_total: 9999 };
const MODELS: [string, string][] = [['gemini', 'a'], ['gemini', 'b'], ['groq', 'c']];

/** behaviour: model -> what each of its reads returns (a Receipt, or an Error to throw), in order. */
async function chain(behaviour: Record<string, (Receipt | Error)[]>) {
  const calls: string[] = [];
  const res = await extractReceipt(new Uint8Array([1]), 'image/jpeg', MODELS, async (_p, model) => {
    calls.push(model);
    const r = behaviour[model].shift()!;
    if (r instanceof Error) throw r;
    return r;
  });
  return { ...res, calls };
}

test('the first read that adds up wins, without reading again', async () => {
  const { model, reads, checksOut, calls } = await chain({ a: [GOOD] });
  assert.deepEqual([model, reads, checksOut, calls], ['a', 1, true, ['a']]);
});

test("a read that doesn't add up is read again, by the next model", async () => {
  const { model, reads, checksOut, calls } = await chain({ a: [BAD], b: [GOOD] });
  assert.deepEqual([model, reads, checksOut, calls], ['b', 2, true, ['a', 'b']]);
});

test('errors count as tries and fall through', async () => {
  const { model, calls } = await chain({ a: [new AIError('429')], b: [new SyntaxError('bad json')], c: [GOOD] });
  assert.deepEqual([model, calls], ['c', ['a', 'b', 'c']]);
});

test('after 3 reads that never add up, the third is returned and flagged', async () => {
  const third = { ...BAD, restaurant: 'third read' };
  const { receipt, reads, checksOut, calls } = await chain({ a: [BAD], b: [BAD], c: [third] });
  assert.deepEqual([receipt.restaurant, reads, checksOut, calls], ['third read', 3, false, ['a', 'b', 'c']]);
});

test('a one-model chain reads with it three times', async () => {
  const calls: string[] = [];
  const res = await extractReceipt(new Uint8Array([1]), 'image/jpeg', [['gemini', 'solo']], async (_p, m) => (calls.push(m), BAD));
  assert.deepEqual([calls, res.checksOut], [['solo', 'solo', 'solo'], false]);
});

test('when every try fails, the errors are reported', async () => {
  await assert.rejects(chain({ a: [new AIError('x')], b: [new AIError('y')], c: [new AIError('z')] }), /in 3 tries/);
});

test('parseReceipt renumbers ids, cleans numbers and refuses empty bills', () => {
  assert.deepEqual(GOOD.items.map((i) => [i.id, i.total, i.qty]), [['i1', 149, 1], ['i2', 210, 1]]);
  assert.equal(GOOD.charges.length, 0);
  assert.throws(() => parseReceipt({ items: [], grand_total: 1 }), /No items/);
  assert.throws(() => parseReceipt({ items: [{ name: 'x', total: 'lots' }], grand_total: 1 }), /Not a number/);
});

test('JSON wrapped in prose or fences still parses', () => {
  assert.deepEqual(parseJson('Sure! ```json\n{"a": 1}\n```'), { a: 1 });
});

test('assignments referring to made-up items or people are dropped and flagged', () => {
  const people = [{ id: 'me', name: 'Me' }, { id: 's', name: 'Sruthi' }];
  const { assignments, flags } = sanitizeAssignments(
    { assignments: { i1: [{ person_id: 'me', units: 1 }, { person_id: 'rahul', units: 1 }], i99: [{ person_id: 'me', units: 1 }] }, flags: [] },
    GOOD,
    people,
  );
  assert.deepEqual(assignments, { i1: { me: 1 } });
  assert.ok(flags.some((f) => f.includes('rahul')));
  assert.ok(flags.some((f) => f.includes('i99')));
  assert.ok(flags.some((f) => f.includes('Nobody was assigned the Shake')));
});
