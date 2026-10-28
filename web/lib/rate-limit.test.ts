import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLimiter } from './rate-limit.ts';

const HOUR = 3_600_000;

test('allows the limit within the window, then says when it frees up', () => {
  const l = createLimiter(HOUR);
  assert.deepEqual([1, 2, 3].map((i) => l.take('ana', 2, i * 1000).ok), [true, true, false]);
  const refused = l.take('ana', 2, 10_000);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.retryMs, 1000 + HOUR - 10_000);
});

test('each key has its own count', () => {
  const l = createLimiter(HOUR);
  assert.equal(l.take('ana', 1, 0).ok, true);
  assert.equal(l.take('ben', 1, 0).ok, true);
  assert.equal(l.take('ana', 1, 1).ok, false);
});

test('old hits roll out of the window', () => {
  const l = createLimiter(HOUR);
  assert.equal(l.take('ana', 1, 0).ok, true);
  assert.equal(l.take('ana', 1, HOUR - 1).ok, false);
  assert.equal(l.take('ana', 1, HOUR + 1).ok, true);
});

test('giveBack undoes a hit', () => {
  const l = createLimiter(HOUR);
  l.take('ana', 1, 0);
  l.giveBack('ana');
  assert.equal(l.take('ana', 1, 1).ok, true);
});
