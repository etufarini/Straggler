import { CircleAlert } from 'lucide-react';

export default function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <small id={id} role="alert" className="field-error">
      <CircleAlert size={14} aria-hidden="true" />
      <span>{message}</span>
    </small>
  ) : null;
}
