import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-body font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5',
  {
    variants: {
      variant: {
        primary: 'bg-cobalt text-white hover:bg-cobalt-hover',
        secondary: 'border border-surface-line bg-surface text-navy hover:bg-surface-muted',
        ghost: 'text-navy hover:bg-surface-muted',
        danger: 'bg-red-600 text-white hover:bg-red-700',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}
