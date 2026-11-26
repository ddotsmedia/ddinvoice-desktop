import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './utils';

/** Compact 28px input. Numeric values stay strings; pass `dir="ltr"` for numbers, IDs and emails. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-7 w-full rounded-md border border-surface-line bg-surface px-2 text-body text-navy placeholder:text-navy-muted/60 focus:border-cobalt focus:outline-none aria-[invalid=true]:border-red-600',
        className,
      )}
      {...props}
    />
  );
});
