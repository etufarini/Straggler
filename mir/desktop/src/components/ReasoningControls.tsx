import { useId } from 'react';
import type { ServerDetails } from '../domain/types';

export default function ReasoningControls({
  reasoning,
  effort,
  details,
  effortPresentation = 'select',
  onReasoning,
  onEffort,
}: {
  reasoning: 'auto' | 'on' | 'off';
  effort: string;
  details: ServerDetails | null;
  effortPresentation?: 'select' | 'segments';
  onReasoning: (value: 'on' | 'off') => void;
  onEffort: (value: string) => void;
}) {
  const id = useId();
  const available = details?.reasoningSupported === true;
  const levels = details?.effortLevels ?? [];
  return (
    <>
      <fieldset className="choice-group" disabled={!available}>
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
      <p className="popover-note">
        {!available
          ? details?.error ||
            'Reasoning controls are unavailable for this server and chat template.'
          : reasoning === 'auto'
            ? 'Using the server default. Choose On or Off to override it.'
            : 'The assistant thinks before answering. Slower, often more thorough.'}
      </p>
      {effortPresentation === 'segments' ? (
        <>
          <fieldset className="choice-group" disabled={!available || reasoning === 'off'}>
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
              ? 'This template does not advertise effort levels.'
              : effort === 'auto'
                ? 'Using the template default. Available levels depend on the model.'
                : 'Available levels depend on the model. Applies from your next message.'}
          </p>
        </>
      ) : (
        <label className="setting-field">
          <span>Reasoning effort</span>
          <select
            aria-label="Reasoning effort"
            disabled={!available || reasoning === 'off' || !levels.length}
            value={effort}
            onChange={(event) => onEffort(event.target.value)}
          >
            <option value="auto">Template default</option>
            {effort !== 'auto' && !levels.includes(effort) && (
              <option value={effort} disabled>
                {effort} (not advertised)
              </option>
            )}
            {levels.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
          <small>
            {available && !levels.length
              ? 'This template does not advertise effort levels.'
              : 'Only levels the model supports are listed. Applies from your next message.'}
          </small>
        </label>
      )}
    </>
  );
}
