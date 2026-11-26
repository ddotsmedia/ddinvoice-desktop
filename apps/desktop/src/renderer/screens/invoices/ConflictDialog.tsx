import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '@ddinvoice/ui';
import type { FieldConflict } from './conflict';

/** Shown on 409 VERSION_CONFLICT: mine vs theirs per field. The user picks which side wins; nothing is merged silently. */
export function ConflictDialog({
  open,
  conflicts,
  onKeepMine,
  onUseTheirs,
  onClose,
}: {
  open: boolean;
  conflicts: FieldConflict[];
  onKeepMine: () => void;
  onUseTheirs: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('conflict.title')}
      description={t('conflict.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onUseTheirs}>
            {t('conflict.useTheirs')}
          </Button>
          <Button variant="primary" onClick={onKeepMine}>
            {t('conflict.keepMine')}
          </Button>
        </>
      }
    >
      <table className="w-full text-left text-body">
        <thead>
          <tr className="text-navy-muted">
            <th className="py-1 pe-3 font-normal">{t('conflict.field')}</th>
            <th className="py-1 pe-3 font-normal">{t('conflict.mine')}</th>
            <th className="py-1 font-normal">{t('conflict.theirs')}</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-1 text-navy-muted">
                {t('conflict.noDifferences')}
              </td>
            </tr>
          ) : (
            conflicts.map((c) => (
              <tr key={c.field} className="border-t border-surface-line">
                <td className="py-1 pe-3">{t(`conflict.fields.${c.field}`)}</td>
                <td className="py-1 pe-3">
                  <bdi dir="auto">{c.mine || '—'}</bdi>
                </td>
                <td className="py-1">
                  <bdi dir="auto">{c.theirs || '—'}</bdi>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Dialog>
  );
}
