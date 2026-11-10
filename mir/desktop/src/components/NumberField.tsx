import { useId } from 'react';
import FieldError from './FieldError';

export default function NumberField({
  label,
  term,
  value,
  onChange,
  disabled = false,
  hint = '',
  error,
}: {
  label: string;
  term?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <label className="setting-field">
      <span>
        {label}
        {term && <code className="tech-term">{term}</code>}
      </span>
      <input
        disabled={disabled}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        inputMode="decimal"
        placeholder="Auto"
        value={value === 'auto' ? '' : value}
        onChange={(event) => onChange(event.target.value || 'auto')}
      />
      <small id={`${id}-hint`}>{hint || 'Leave empty for the native default.'}</small>
      <FieldError id={`${id}-error`} message={error} />
    </label>
  );
}
