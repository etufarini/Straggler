import { createContext, useContext } from 'react';
import type { Settings } from '../../domain/types';
import { fileName } from '../../domain/types';

export const ChangedSettingsContext = createContext<{
  draft: Settings;
  saved: Settings | null;
} | null>(null);

export default function ChangedSetting({ field }: { field?: keyof Settings }) {
  const values = useContext(ChangedSettingsContext);
  if (!values?.saved || !field || values.draft[field] === values.saved[field]) return null;
  const previous = values.saved[field];
  const display = ['model', 'chat_template_file', 'mtp_file'].includes(field)
    ? fileName(previous)
    : previous;
  return (
    <small className="changed-setting" role="note">
      Changed · was {display || 'empty'}
    </small>
  );
}
