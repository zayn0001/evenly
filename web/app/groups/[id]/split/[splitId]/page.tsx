'use client';

import { useParams } from 'next/navigation';

import { SignedIn } from '@/components/auth';
import { SplitEditor } from '@/components/split-editor';

/** Editing a saved split: same steps, starting from what was saved. */
export default function EditSplit() {
  const { id, splitId } = useParams<{ id: string; splitId: string }>();
  return (
    <SignedIn>
      <SplitEditor groupId={id} splitId={splitId} />
    </SignedIn>
  );
}
