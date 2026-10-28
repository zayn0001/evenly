import assert from 'node:assert/strict';
import { test } from 'node:test';

import { itemStatus, shareEqually } from './assign.ts';

const apples = { qty: 3 };

test('a counted item is only done when the units add up to the quantity', () => {
  assert.deepEqual(itemStatus(apples, { ana: 1 }), { kind: 'short', assigned: 1, qty: 3 });
  assert.deepEqual(itemStatus(apples, { ana: 2, ben: 2 }), { kind: 'over', assigned: 4, qty: 3 });
  assert.deepEqual(itemStatus(apples, { ana: 2, ben: 1 }), { kind: 'done' });
  assert.deepEqual(itemStatus(apples, {}), { kind: 'empty' });
});

test('single dishes and weights are shared by whoever is picked', () => {
  assert.deepEqual(itemStatus({ qty: 1 }, { ana: 1, ben: 1 }), { kind: 'done' });
  assert.deepEqual(itemStatus({ qty: 0.58 }, { ana: 1 }), { kind: 'done' });
});

test('sharing equally spreads the whole quantity, thirds included', () => {
  assert.deepEqual(shareEqually(apples, ['ana', 'ben']), { ana: 1.5, ben: 1.5 });
  const thirds = shareEqually({ qty: 7 }, ['a', 'b', 'c']);
  assert.deepEqual(itemStatus({ qty: 7 }, thirds), { kind: 'done' });
  assert.deepEqual(shareEqually({ qty: 1 }, ['a', 'b']), { a: 1, b: 1 });
});

test('switched to a ratio, a counted item takes any proportions', () => {
  const byRatio = { qty: 3, split: 'ratio' as const };
  assert.deepEqual(itemStatus(byRatio, { ana: 2, ben: 1 }), { kind: 'done' });
  assert.deepEqual(itemStatus(byRatio, { ana: 1 }), { kind: 'done' });
  assert.deepEqual(shareEqually(byRatio, ['ana', 'ben']), { ana: 1, ben: 1 });
});
