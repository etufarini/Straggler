import SettingsField from './SettingsField';

export default function NumberField({
  label,
  term,
  value,
  onChange,
  disabled = false,
  hint = '',
  error,
  scope,
  onBlur,
}: {
  label: string;
  term?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
  error?: string;
  scope?: string;
  onBlur?: () => void;
}) {
  return (
    <SettingsField
      label={
        <>
          {label}
          {term && <code className="tech-term">{term}</code>}
        </>
      }
      hint={hint || 'Leave empty for the native default.'}
      scope={scope}
      error={error}
    >
      {(accessibility) => (
        <input
          {...accessibility}
          disabled={disabled}
          aria-label={label}
          inputMode="decimal"
          placeholder="Auto"
          value={value === 'auto' ? '' : value}
          onChange={(event) => onChange(event.target.value || 'auto')}
          onBlur={onBlur}
        />
      )}
    </SettingsField>
  );
}
