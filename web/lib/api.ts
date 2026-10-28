// The site's own API routes (bill reading, who-had-what), called with your session token.
import { supabase } from './supabase';
import type { AssignResponse, Person, Receipt, ScanResponse } from './types';

async function post<T>(path: string, form: FormData): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Something went wrong (${res.status}).`);
  return body as T;
}

/** A data: URL, so the picture survives the tab reloading (blob: URLs don't). */
export const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const MAX_SIDE = 2000; // px: plenty for printed bills, and keeps uploads small on mobile data

/** Phone photos are 4000+ px and several MB; shrink to a JPEG before uploading. */
export async function shrinkImage(file: File): Promise<Blob> {
  // createImageBitmap applies the photo's EXIF rotation, so sideways shots come out upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) return file; // a format the browser can't decode: let the server try
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.8));
}

/** `image` should already be shrunk (shrinkImage). */
export async function scanBill(image: Blob): Promise<ScanResponse> {
  const form = new FormData();
  form.append('image', image, 'bill.jpg');
  return post('/api/scan', form);
}

/** Who had what, from a recording or typed text. */
export async function assign(
  input: { audio: Blob } | { transcript: string },
  receipt: Receipt,
  people: Person[],
  meId: string | null,
): Promise<AssignResponse> {
  const form = new FormData();
  form.append(
    'context',
    JSON.stringify({ items: receipt.items.map(({ id, name, qty }) => ({ id, name, qty })), people, me_id: meId }),
  );
  if ('audio' in input) {
    const ext = input.audio.type.includes('mp4') ? 'mp4' : input.audio.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', input.audio, `clip.${ext}`);
  } else {
    form.append('transcript', input.transcript);
  }
  return post('/api/assign', form);
}
