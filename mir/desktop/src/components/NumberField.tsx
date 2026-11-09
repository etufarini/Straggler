export default function NumberField({
  label,
  value,
  onChange,
  disabled = false,
  hint = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="setting-field">
      <span>{label}</span>
      <input
        disabled={disabled}
        inputMode="decimal"
        placeholder="Auto"
        value={value === 'auto' ? '' : value}
        onChange={(event) => onChange(event.target.value || 'auto')}
      />
      <small>{hint || 'Leave empty for the native default.'}</small>
    </label>
  );
}
