'use client';
import { useEffect } from 'react';

/** Next 14 puede perder el fragmento al seguir el redirect de una server action. */
export function TaskFocus({ taskId }: { taskId: string }) {
  useEffect(() => {
    const anchor = `tarea-${taskId}`;
    const url = new URL(window.location.href);
    url.hash = anchor;
    window.history.replaceState(window.history.state, '', url);
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  }, [taskId]);
  return null;
}
