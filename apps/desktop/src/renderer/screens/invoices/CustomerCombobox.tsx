import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, Dialog, Input } from '@ddinvoice/ui';
import { ApiError } from '../../lib/api';
import { useAccounts, useCreateCustomer } from '../../lib/queries';
import type { Customer } from '../../lib/types';
import { toast } from 'sonner';

interface Props {
  customers: Customer[];
  value: Customer | null;
  disabled: boolean;
  error?: string;
  onSelect: (c: Customer) => void;
}

/** Customer picker with type-ahead, arrow-key selection and inline "create customer". */
export function CustomerCombobox({ customers, value, disabled, error, onSelect }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => !q || c.nameEn.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)).slice(0, 20);
  }, [customers, query]);

  const choose = (c: Customer) => {
    onSelect(c);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        dir="auto"
        disabled={disabled}
        aria-invalid={!!error}
        placeholder={value ? value.nameEn : t('invoices.editor.customerPlaceholder')}
        value={query}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {value && query === '' ? (
        <div className="mt-0.5 text-navy-muted">
          <bdi dir="ltr">{value.code}</bdi>
        </div>
      ) : null}
      {error ? <span className="text-[12px] text-red-700">{error}</span> : null}
      {open && !disabled ? (
        <ul role="listbox" className="absolute z-20 mt-0.5 max-h-64 w-full overflow-auto rounded-md border border-surface-line bg-surface shadow-md">
          {matches.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-2 py-1 ${i === active ? 'bg-cobalt-soft' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
            >
              {c.nameEn} <span className="text-navy-muted"><bdi dir="ltr">{c.code}</bdi></span>
            </li>
          ))}
          <li className="border-t border-surface-line">
            <button type="button" className="w-full px-2 py-1 text-start text-cobalt hover:bg-surface-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => setCreateOpen(true)}>
              + {t('invoices.editor.quickCreate')}
            </button>
          </li>
        </ul>
      ) : null}
      <QuickCreateCustomer open={createOpen} onOpenChange={setCreateOpen} onCreated={choose} />
    </div>
  );
}

const quickSchema = z.object({
  code: z.string().min(1, { error: 'validation.required' }).max(32),
  nameEn: z.string().min(1, { error: 'validation.required' }).max(200),
  nameAr: z.string().min(1, { error: 'validation.required' }).max(200),
  email: z.email({ error: 'validation.invalidEmail' }),
  phone: z.string().min(3, { error: 'validation.required' }).max(32),
  addressEn: z.string().max(500),
  addressAr: z.string().max(500),
  trn: z.string().regex(/^(\d{15})?$/, { error: 'validation.trn' }),
  receivableAccountId: z.string().min(1, { error: 'validation.required' }),
});
type QuickValues = z.infer<typeof quickSchema>;

/** Minimal customer create used from the invoice editor. The full customer form lives on the Customers screen. */
function QuickCreateCustomer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Customer) => void }) {
  const { t } = useTranslation();
  const create = useCreateCustomer();
  const accounts = useAccounts(open);
  const receivables = (accounts.data ?? []).filter((a) => a.type === 'ASSET');
  const { register, handleSubmit, formState, reset } = useForm<QuickValues>({
    resolver: zodResolver(quickSchema),
    defaultValues: { code: '', nameEn: '', nameAr: '', email: '', phone: '', addressEn: '', addressAr: '', trn: '', receivableAccountId: '' },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      const customer = await create.mutateAsync({
        code: v.code,
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        email: v.email,
        phone: v.phone,
        addressEn: v.addressEn,
        addressAr: v.addressAr,
        ...(v.trn ? { trn: v.trn } : {}),
        country: 'AE',
        currency: 'AED',
        paymentTermsDays: 30,
        receivableAccountId: v.receivableAccountId,
      });
      reset();
      onOpenChange(false);
      onCreated(customer);
    } catch (e) {
      toast.error(e instanceof ApiError ? t(e.messageKey) : t('errors.generic'));
    }
  });

  const field = (name: keyof QuickValues, label: string, props: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="mb-0.5 block text-navy-muted">{label}</span>
      <Input aria-invalid={!!formState.errors[name]} {...props} {...register(name)} />
      {formState.errors[name] ? <span className="text-[12px] text-red-700">{t(formState.errors[name]?.message ?? 'validation.required')}</span> : null}
    </label>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('invoices.editor.quickCreate')}
      className="w-[520px]"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} disabled={create.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {field('code', t('customers.code'), { dir: 'ltr' })}
        {field('trn', t('customers.trn'), { dir: 'ltr', inputMode: 'numeric' })}
        {field('nameEn', t('customers.nameEn'), { dir: 'ltr' })}
        {field('nameAr', t('customers.nameAr'))}
        {field('email', t('customers.email'), { dir: 'ltr', type: 'email' })}
        {field('phone', t('customers.phone'), { dir: 'ltr' })}
        {field('addressEn', t('customers.addressEn'), { dir: 'ltr' })}
        {field('addressAr', t('customers.addressAr'))}
        <label className="col-span-2 block">
          <span className="mb-0.5 block text-navy-muted">{t('customers.receivableAccount')}</span>
          <select className="h-7 w-full rounded-md border border-surface-line bg-surface px-2" {...register('receivableAccountId')}>
            <option value="">—</option>
            {receivables.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.nameEn}
              </option>
            ))}
          </select>
          {formState.errors.receivableAccountId ? <span className="text-[12px] text-red-700">{t('validation.required')}</span> : null}
        </label>
      </div>
    </Dialog>
  );
}
