import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from './utils';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Modal dialog built on Radix (focus trap, Escape to close). */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-navy/30" />
        <RadixDialog.Content
          className={cn('fixed left-1/2 top-1/2 w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-4 shadow-lg focus:outline-none', className)}
        >
          <RadixDialog.Title className="text-[15px] font-semibold text-navy">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="mt-1 text-body text-navy-muted">{description}</RadixDialog.Description> : null}
          {children ? <div className="mt-3">{children}</div> : null}
          {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
