export default function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <small id={id} role="alert" className="field-error">
      {message}
    </small>
  ) : null;
}
