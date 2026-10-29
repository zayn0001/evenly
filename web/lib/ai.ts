// Server only: AI calls through OpenAI-compatible APIs, so providers are swappable.
// Bills: a chain of vision models (Gemini free tier first, Groq's open-weight Qwen as fallback).
// Who-had-what: Whisper for speech, then an open-weight text model on Groq.
import { reconcile, withImpliedRoundOff } from './reconcile.ts';
import type { Assignments, Person, Receipt } from './types.ts';

const env = (k: string, fallback = '') => process.env[k] || fallback;

const PROVIDERS: Record<string, { url: string; key: () => string }> = {
  groq: { url: 'https://api.groq.com/openai/v1', key: () => env('GROQ_API_KEY') },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', key: () => env('GEMINI_API_KEY') },
};

/** Tried in order; providers without a key are skipped. "provider:model", comma separated. */
export const receiptModels = () =>
  // Fastest first. 3.8 Flash reads hard bills better but is often overloaded or slow: last resort.
  env('RECEIPT_MODELS', 'gemini:gemini-3.5-flash-lite,groq:qwen/qwen3.8-27b,gemini:gemini-3.8-flash')
    .split(',')
    .map((e) => e.trim().split(':', 2) as [string, string])
    .filter(([p, m]) => m && PROVIDERS[p]?.key());

const TEXT_MODEL = () => env('TEXT_MODEL', 'openai/gpt-oss-120b');
const STT_MODEL = () => env('STT_MODEL', 'whisper-large-v3-turbo');
// A hung or overloaded model falls through to the next one instead of stalling the scan.
const RECEIPT_TIMEOUT_MS = () => Number(env('RECEIPT_TIMEOUT_SECONDS', '20')) * 1000;

export class AIError extends Error {}

async function call(provider: string, path: string, body: BodyInit, json: boolean, timeoutMs: number) {
  const p = PROVIDERS[provider];
  const res = await fetch(p.url + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key()}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new AIError(`${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in prose or ``` fences; take the outermost object.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new AIError(`The model didn't return JSON: ${text.slice(0, 200)}`);
    return JSON.parse(m[0]);
  }
}

async function chatJson(provider: string, model: string, messages: unknown[], timeoutMs = 90_000) {
  const data = await call(
    provider,
    '/chat/completions',
    JSON.stringify({ model, messages, temperature: 0, response_format: { type: 'json_object' } }),
    true,
    timeoutMs,
  );
  return parseJson(data.choices[0].message.content);
}

// ---------------------------------------------------------------- validation (never trust model output)
const num = (v: unknown, fallback?: number): number => {
  const n = typeof v === 'string' ? Number(v.replace(/[₹,\s]/g, '')) : Number(v);
  if (Number.isFinite(n)) return n;
  if (fallback !== undefined) return fallback;
  throw new AIError(`Not a number: ${String(v).slice(0, 40)}`);
};
const str = (v: unknown, max = 120) => String(v ?? '').trim().slice(0, max);
const adjustments = (v: unknown) =>
  (Array.isArray(v) ? v : []).slice(0, 30).map((a) => ({
    name: str(a?.name, 80) || 'Charge',
    amount: num(a?.amount),
    applies_to: ['all', 'food', 'alcohol', 'other'].includes(a?.applies_to) ? a.applies_to : 'all',
  }));

/** Shapes untrusted JSON (from a model or a browser) into a Receipt, or throws. */
export function parseReceipt(data: unknown): Receipt {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(d.items) || d.items.length === 0) throw new AIError('No items on the bill');
  if (d.items.length > 200) throw new AIError('Too many items');
  return {
    restaurant: str(d.restaurant) || null,
    // Our own ids, in order: never trust ids from a model.
    items: d.items.map((i: Record<string, unknown>, n: number) => ({
      id: `i${n + 1}`,
      name: str(i?.name) || `Item ${n + 1}`,
      qty: Math.max(num(i?.qty, 1), 0) || 1,
      unit_price: i?.unit_price == null ? null : num(i.unit_price, 0),
      total: num(i?.total),
      tax_class: ['food', 'alcohol', 'other'].includes(i?.tax_class as string) ? (i.tax_class as string) : 'food',
    })),
    charges: adjustments(d.charges),
    taxes: adjustments(d.taxes),
    round_off: num(d.round_off, 0),
    grand_total: num(d.grand_total),
  };
}

// ---------------------------------------------------------------- bills
const RECEIPT_PROMPT = `You extract Indian restaurant bills into JSON. Return ONLY this shape:
{
  "restaurant": string|null,
  "items": [{"id": "i1", "name": str, "qty": number, "unit_price": number|null, "total": number, "tax_class": "food"|"alcohol"|"other"}],
  "charges": [{"name": str, "amount": number, "applies_to": "all"|"food"|"alcohol"}],
  "taxes": [{"name": str, "amount": number, "applies_to": "all"|"food"|"alcohol"}],
  "round_off": number,
  "grand_total": number
}
Rules:
- One entry per printed line item; ids i1, i2, ... in order. "total" is the line amount as printed.
- CGST and SGST are separate tax entries. GST normally applies_to "food".
- VAT on liquor/beer/wine applies_to "alcohol"; mark those items tax_class "alcohol".
- Service charge, packing/delivery charges go in "charges". Discounts go in "charges" with a NEGATIVE amount.
- round_off is signed (e.g. -0.40). Use 0 if absent.
- Copy numbers exactly as printed. Do not invent lines. Do not compute values that are not printed except qty=1 when missing.`;

type Extract = (provider: string, model: string, dataUrl: string) => Promise<Receipt>;

const extractWith: Extract = async (provider, model, dataUrl) =>
  withImpliedRoundOff(parseReceipt(
    await chatJson(
      provider,
      model,
      [
        { role: 'system', content: RECEIPT_PROMPT },
        { role: 'user', content: [{ type: 'text', text: 'Extract this bill.' }, { type: 'image_url', image_url: { url: dataUrl } }] },
      ],
      RECEIPT_TIMEOUT_MS(),
    ),
  ));

export const MAX_READS = 3;

/**
 * Reads the bill until its numbers add up (items + charges + taxes vs grand total), at most MAX_READS
 * times, moving through the model chain in order (and around again if it's shorter). If no read
 * adds up, the last one is returned with `checksOut: false` for the person to correct. A failed
 * call (rate limit, bad JSON, timeout) counts as a try.
 */
export async function extractReceipt(
  image: Uint8Array,
  mime: string,
  models = receiptModels(),
  extract: Extract = extractWith,
): Promise<{ receipt: Receipt; model: string; reads: number; checksOut: boolean }> {
  if (models.length === 0) throw new AIError('No AI keys configured: set GEMINI_API_KEY and/or GROQ_API_KEY.');
  const dataUrl = `data:${mime};base64,${Buffer.from(image).toString('base64')}`;
  let last: { receipt: Receipt; model: string } | null = null;
  const errors: string[] = [];
  for (let read = 1; read <= MAX_READS; read++) {
    const [provider, model] = models[(read - 1) % models.length];
    try {
      const receipt = await extract(provider, model, dataUrl);
      if (reconcile(receipt).length === 0) return { receipt, model, reads: read, checksOut: true };
      last = { receipt, model };
    } catch (e) {
      errors.push(`${model}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`.slice(0, 160));
    }
  }
  if (last) return { ...last, reads: MAX_READS, checksOut: false };
  throw new AIError(`Couldn't read the bill in ${MAX_READS} tries. ${errors.join(' | ')}`);
}

// ---------------------------------------------------------------- who had what
export async function transcribe(audio: Blob, filename: string, hints: string): Promise<string> {
  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', STT_MODEL());
  // Whisper's prompt biases spelling toward the names and dishes it sees.
  form.append('prompt', hints.slice(0, 800));
  form.append('language', 'en');
  form.append('temperature', '0');
  const data = await call('groq', '/audio/transcriptions', form, false, 60_000);
  return String(data.text ?? '').trim();
}

const ASSIGN_PROMPT = `You turn a spoken description of who ate what into bill assignments.
You get the bill items (with ids and quantities) and the people at the meal (with ids).
"I", "me", "my", "myself" refer to the person whose id is ME_ID (if given). "we"/"everyone"/"all of us" means every person.
Names in the transcript may be misspelled by speech recognition (Indian names especially): match to the closest person.

Return ONLY JSON:
{"assignments": {"<item_id>": [{"person_id": "<id>", "units": number}]}, "ratio": ["<item_id>"], "flags": [str]}

Rules:
- units = how many of that item the person had. "2 naans each" -> units 2 per person. "split a roti" between two people -> 0.5 each.
- When the speaker gives an item's split as proportions rather than amounts ("2 to 1", "60/40", "70 percent", "twice as much as", "a third each", "split it 3:2"), give the proportions as units (60/40 -> 60 and 40; "twice as much as Ben" -> 2 for them, 1 for Ben) and list that item id in "ratio". Items given as amounts or shared equally are not listed.
- If people shared an item without a count, give each units 1 (equal weights).
- Only use item ids and person ids from the input. Never invent ids.
- Add a flag for: uncertain name matches (e.g. "heard 'Shruti', matched to Sruthi"), items nobody mentioned, quantities that don't add up to the item qty, anything ambiguous.
- Leave unmentioned items out of assignments (and flag them).`;

export async function assignFromTranscript(transcript: string, receipt: Receipt, people: Person[], meId: string | null) {
  const payload = {
    ME_ID: meId,
    items: receipt.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    transcript,
  };
  const data = await chatJson('groq', TEXT_MODEL(), [
    { role: 'system', content: ASSIGN_PROMPT },
    { role: 'user', content: JSON.stringify(payload) },
  ]);
  return sanitizeAssignments(data, receipt, people);
}

/** Drops anything that refers to ids we didn't give the model. */
export function sanitizeAssignments(data: Record<string, unknown>, receipt: Receipt, people: Person[]) {
  const itemIds = new Set(receipt.items.map((i) => i.id));
  const personIds = new Set(people.map((p) => p.id));
  const flags = (Array.isArray(data.flags) ? data.flags : []).map((f) => str(f, 300));
  const assignments: Assignments = {};
  for (const [itemId, shares] of Object.entries((data.assignments ?? {}) as Record<string, unknown>)) {
    if (!itemIds.has(itemId)) {
      flags.push(`Ignored unknown item id '${itemId}'`);
      continue;
    }
    const clean: Record<string, number> = {};
    for (const s of Array.isArray(shares) ? shares : []) {
      const pid = str(s?.person_id, 64);
      const units = num(s?.units, 1);
      if (!personIds.has(pid)) flags.push(`Ignored unknown person id '${pid}'`);
      else if (units > 0) clean[pid] = (clean[pid] ?? 0) + units;
    }
    if (Object.keys(clean).length) assignments[itemId] = clean;
  }
  for (const item of receipt.items) {
    if (!assignments[item.id] && !flags.some((f) => f.toLowerCase().includes(item.name.toLowerCase()))) {
      flags.push(`Nobody was assigned the ${item.name}`);
    }
  }
  // Items the speaker split by proportion ("60/40"): the app switches them to ratio mode.
  const ratio = (Array.isArray(data.ratio) ? data.ratio : []).map((id) => str(id, 64)).filter((id) => assignments[id]);
  return { assignments, flags, ratio: [...new Set(ratio)] };
}
