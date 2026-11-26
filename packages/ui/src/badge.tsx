import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-navy-muted border-surface-line',
  info: 'bg-cobalt-soft text-cobalt border-cobalt-soft',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  warning: 'bg-amber-50 text-amber-800 border-amber-100',
  danger: 'bg-red-50 text-red-700 border-red-100',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[12px] leading-4', TONES[tone], className)} {...props} />;
}
