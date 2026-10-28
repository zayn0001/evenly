'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth';

export default function Home() {
  const { session, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready) router.replace(session ? '/groups' : '/sign-in');
  }, [ready, session, router]);
  return null;
}
