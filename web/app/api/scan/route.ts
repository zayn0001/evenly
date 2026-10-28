import { AIError, extractReceipt } from '@/lib/ai';
import { reconcile } from '@/lib/reconcile';
import { fail, guard } from '@/lib/server';

// The browser shrinks photos to ~2000 px first, so real uploads are well under this.
const MAX_BYTES = 4 * 1024 * 1024;

/** multipart `image` -> the bill as JSON, plus any numbers that don't add up. */
export async function POST(request: Request) {
  const denied = await guard(request, 'scan');
  if (denied) return denied;

  const image = (await request.formData().catch(() => null))?.get('image');
  if (!(image instanceof File)) return fail(400, 'Attach a photo of the bill.');
  if (image.size > MAX_BYTES) return fail(413, 'That photo is too big (max 4 MB).');
  if (!image.type.startsWith('image/')) return fail(415, 'That file is not an image.');

  try {
    const { receipt, model } = await extractReceipt(new Uint8Array(await image.arrayBuffer()), image.type);
    return Response.json({ receipt, issues: reconcile(receipt), model });
  } catch (e) {
    return fail(502, `Couldn't read the bill: ${e instanceof AIError || e instanceof Error ? e.message : String(e)}`);
  }
}
