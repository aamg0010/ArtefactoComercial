'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function JobRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
