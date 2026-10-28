'use client';

import { useParams } from 'next/navigation';

import { SignedIn } from '@/components/auth';
import { SplitEditor } from '@/components/split-editor';

export default function NewSplit() {
  const { id } = useParams<{ id: string }>();
  return (
    <SignedIn>
      <SplitEditor groupId={id} />
    </SignedIn>
  );
}
