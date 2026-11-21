import { useId } from 'react';
import type { ServerDetails } from '../domain/types';
import Select from './Select';

export default function ReasoningControls({
  reasoning,
  effort,
  details,
  disabled = false,
  effortPresentation = 'select',
  showToggle = true,
  cloud = false,
  onReasoning,
  onEffort,
}: {
  reasoning: 'auto' | 'on' | 'off';
  effort: string;
  details: ServerDetails | null;
  disabled?: boolean;
  effortPresentation?: 'select' | 'segments';
  showToggle?: boolean;
  cloud?: boolean;
  onReasoning: (value: 'on' | 'off') => void;
  onEffort: (value: string) => void;
}) {
  const id = useId();
  const available = details?.reasoningSupported === true;
  const levels = details?.effortLevels ?? [];
  return (
    <>
      {showToggle && (
        <fieldset className="choice-group" disabled={disabled || !available}>
          <legend>Reasoning</legend>
          <div className="segmented">
            {(['on', 'off'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${id}-reasoning`}
                  value={value}
                  checked={reasoning === value}
                  onChange={() => onReasoning(value)}
                />
                <span>{value === 'on' ? 'On' : 'Off'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="popover-note">
        {!available
          ? details?.error ||
            (cloud
              ? 'This service does not list reasoning controls for the model.'
              : 'Reasoning controls are unavailable for this server and chat template.')
          : reasoning === 'auto'
            ? cloud
              ? 'Using the service default.'
              : 'Using the server default. Choose On or Off to override it.'
            : 'The assistant thinks before answering. Slower, often more thorough.'}
      </p>
      {effortPresentation === 'segments' ? (
        <>
          <fieldset
            className="choice-group"
            disabled={disabled || !available || reasoning === 'off'}
          >
            <legend>Reasoning effort</legend>
            <div className="segmented">
              {levels.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${id}-effort`}
                    checked={effort === value}
                    onChange={() => onEffort(value)}
                  />
                  <span>{value.charAt(0).toUpperCase() + value.slice(1)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="popover-note">
            {!levels.length
              ? cloud
                ? 'This service does not advertise effort levels.'
                : 'This template does not advertise effort levels.'
              : effort === 'auto'
                ? cloud
                  ? 'Using the service default.'
                  : 'Using the template default.'
                : 'Available levels depend on the model. Applies from your next message.'}
          </p>
        </>
      ) : (
        <label className="setting-field">
          <span>Reasoning effort</span>
          <Select
            aria-label="Reasoning effort"
            disabled={disabled || !available || reasoning === 'off' || !levels.length}
            value={effort}
            onChange={onEffort}
            options={[
              { value: 'auto', label: 'Template default' },
              ...(effort !== 'auto' && !levels.includes(effort)
                ? [{ value: effort, label: `${effort} (not advertised)`, disabled: true }]
                : []),
              ...levels.map((value) => ({
                value,
                label: value.charAt(0).toUpperCase() + value.slice(1),
              })),
            ]}
          />
          <small>
            {available && !levels.length
              ? cloud
                ? 'This service does not advertise effort levels.'
                : 'This template does not advertise effort levels.'
              : 'Applies from your next message.'}
          </small>
        </label>
      )}
    </>
  );
}
