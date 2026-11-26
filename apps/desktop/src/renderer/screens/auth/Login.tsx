import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, Input } from '@ddinvoice/ui';
import { ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';

const schema = z.object({
  email: z.email({ error: 'validation.invalidEmail' }),
  password: z.string().min(1, { error: 'validation.required' }),
});
type LoginValues = z.infer<typeof schema>;

export function Login() {
  const { t } = useTranslation();
  const { signIn, config } = useSession();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setServerError(null);
    try {
      await signIn(values.email, values.password);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setServerError(status === 401 || status === 403 ? t('login.invalid') : t(e instanceof ApiError ? e.messageKey : 'errors.generic'));
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={onSubmit} noValidate className="w-80 space-y-3 rounded-lg border border-surface-line bg-surface p-5">
        <h1 className="text-[18px] font-semibold text-navy">{t('login.title')}</h1>
        <p className="text-[12px] text-navy-muted">
          <bdi dir="ltr">{config.serverOrigin}</bdi>
        </p>
        <label className="block">
          <span className="mb-1 block text-navy-muted">{t('login.email')}</span>
          <Input dir="ltr" type="email" autoComplete="username" aria-invalid={!!formState.errors.email} {...register('email')} />
          {formState.errors.email ? <span className="text-[12px] text-red-700">{t(formState.errors.email.message ?? 'validation.required')}</span> : null}
        </label>
        <label className="block">
          <span className="mb-1 block text-navy-muted">{t('login.password')}</span>
          <Input dir="ltr" type="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} {...register('password')} />
          {formState.errors.password ? <span className="text-[12px] text-red-700">{t(formState.errors.password.message ?? 'validation.required')}</span> : null}
        </label>
        {serverError ? (
          <p role="alert" className="text-red-700">
            {serverError}
          </p>
        ) : null}
        <Button variant="primary" type="submit" className="w-full" disabled={submitting}>
          {t('login.submit')}
        </Button>
      </form>
    </div>
  );
}
