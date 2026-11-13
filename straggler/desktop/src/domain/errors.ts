import type { Settings } from './types';

export function isContextRejection(message: string): boolean {
  return message.includes('exceed_context_size_error');
}

export interface SettingsFailure {
  message: string;
  field?: keyof Settings;
  value?: string;
  section?: string;
}

export function errorDetail(error: unknown): { message: string; field?: string } {
  if (error instanceof Error) return { message: error.message };
  if (error && typeof error === 'object' && 'message' in error) {
    const value = error as { message: unknown; field?: unknown };
    return {
      message: String(value.message),
      field: typeof value.field === 'string' ? value.field : undefined,
    };
  }
  const message = String(error);
  // Native configuration failures can carry a JSON validation record as text.
  for (const line of message.split('\n')) {
    try {
      const value = JSON.parse(line);
      if (value?.stragglerValidation === true && typeof value.message === 'string')
        return errorDetail(value);
    } catch {
      // Keep unstructured native diagnostics intact.
    }
  }
  return { message };
}

export function settingsFailure(error: unknown, settings: Settings | null): SettingsFailure {
  const detail = errorDetail(error);
  const field =
    detail.field && settings && Object.hasOwn(settings, detail.field)
      ? (detail.field as keyof Settings)
      : undefined;
  return { message: detail.message, field, value: field ? settings![field] : undefined };
}
