import ChangedSetting from '../features/settings/ChangedSetting';
import type { Settings } from '../domain/types';
import { useId } from 'react';
import type { ReactNode } from 'react';
import FieldError from './FieldError';

type FieldAccessibility = {
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
};

export default function SettingsField({
  label,
  field,
  hint,
  scope,
  error,
  children,
}: {
  field?: keyof Settings;
  label: ReactNode;
  hint?: ReactNode;
  scope?: string;
  error?: string;
  children: (accessibility: FieldAccessibility) => ReactNode;
}) {
  const id = useId();
  const description =
    [hint ? `${id}-hint` : '', !error && scope ? `${id}-scope` : '', error ? `${id}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <label id={field ? `setting-${field}` : undefined} className="setting-field">
      <span>{label}</span>
      {children({ 'aria-describedby': description, 'aria-invalid': error ? true : undefined })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {scope && !error && (
        <small className="field-scope" id={`${id}-scope`}>
          {scope}
        </small>
      )}
      <ChangedSetting field={field} />
      <FieldError id={`${id}-error`} message={error} />
    </label>
  );
}
