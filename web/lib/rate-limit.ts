// Rolling-window limits kept in memory: how many times a key may act in the last `windowMs`.
// ponytail: per server process, so counts reset on restart or redeploy and aren't shared between
// instances (Render's free plan runs one). Move to Redis or the database if that ever matters.

export function createLimiter(windowMs: number) {
  const hits = new Map<string, number[]>();

  /** Records a hit for `key` if it's under `limit`; otherwise returns how many ms until it frees up. */
  function take(key: string, limit: number, now = Date.now()): { ok: true } | { ok: false; retryMs: number } {
    const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return { ok: false, retryMs: recent[0] + windowMs - now };
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) for (const [k, ts] of hits) if (ts.every((t) => t <= now - windowMs)) hits.delete(k);
    return { ok: true };
  }

  /** Undoes the last hit, for when a later check refuses the request after all. */
  const giveBack = (key: string) => void hits.get(key)?.pop();

  return { take, giveBack };
}
