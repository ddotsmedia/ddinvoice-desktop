import type { ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

// shadcn-style button (variants expanded in later phases)
export const Button = ({ className, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={clsx('rounded-md bg-primary px-4 py-2 text-white', className)} {...p} />
);
