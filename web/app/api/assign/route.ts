import { assignFromTranscript, transcribe } from '@/lib/ai';
import { fail, guard } from '@/lib/server';
import type { Person, Receipt } from '@/lib/types';

const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // a minute of browser audio is well under 1 MB
const MAX_TRANSCRIPT = 2000;

/**
 * Who had what, from speech or text. multipart:
 *   context    JSON {items: [{id, name, qty}], people: [{id, name}], me_id}
 *   audio      a recording, or
 *   transcript what they typed
 */
export async function POST(request: Request) {
  const denied = await guard(request, 'assign');
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, 'Expected a form upload.');
  let ctx: { receipt: Receipt; people: Person[]; meId: string | null };
  try {
    ctx = parseContext(JSON.parse(String(form.get('context'))));
  } catch (e) {
    return fail(422, `Bad context: ${e instanceof Error ? e.message : e}`);
  }

  const audio = form.get('audio');
  let transcript = String(form.get('transcript') ?? '').trim();
  try {
    if (audio instanceof File) {
      if (audio.size > MAX_AUDIO_BYTES) return fail(413, 'That recording is too long.');
      const hints = `People: ${ctx.people.map((p) => p.name).join(', ')}. Dishes: ${ctx.receipt.items.map((i) => i.name).join(', ')}.`;
      transcript = await transcribe(audio, audio.name || 'clip.webm', hints);
    }
    if (!transcript) return fail(400, 'Say or type who had what first.');
    if (transcript.length > MAX_TRANSCRIPT) return fail(413, 'That is a bit long. Keep it under 2000 characters.');
    const { assignments, flags, ratio } = await assignFromTranscript(transcript, ctx.receipt, ctx.people, ctx.meId);
    return Response.json({ transcript, assignments, flags, ratio });
  } catch (e) {
    return fail(502, `Couldn't work it out: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Only the fields the model needs, with the browser's own ids kept (assignments refer to them). */
function parseContext(raw: unknown) {
  const c = (raw ?? {}) as Record<string, unknown>;
  const id = (v: unknown) => {
    const s = String(v ?? '');
    if (!/^[\w-]{1,64}$/.test(s)) throw new Error(`bad id ${s.slice(0, 20)}`);
    return s;
  };
  const items = Array.isArray(c.items) ? c.items.slice(0, 200) : [];
  const people = Array.isArray(c.people) ? c.people.slice(0, 50) : [];
  if (!items.length || !people.length) throw new Error('needs items and people');
  const receipt = {
    restaurant: null,
    items: items.map((i) => ({ id: id(i?.id), name: String(i?.name ?? '').slice(0, 120), qty: Number(i?.qty) || 1, unit_price: null, total: 0, tax_class: 'food' })),
    charges: [],
    taxes: [],
    round_off: 0,
    subtotal: null,
    grand_total: 0,
  } satisfies Receipt;
  return {
    receipt,
    people: people.map((p) => ({ id: id(p?.id), name: String(p?.name ?? '').slice(0, 60) })),
    meId: c.me_id ? id(c.me_id) : null,
  };
}
