import { Lightbulb, ChevronDown } from 'lucide-react';
import Popover from '../../components/Popover';
import ReasoningControls from '../../components/ReasoningControls';
import { resolveChatOptions } from '../../domain/chat';
import type { WorkspaceController } from '../../app/useWorkspace';

export default function ReasoningMenu({ controller }: { controller: WorkspaceController }) {
  const { chat, config, serverDetails, chatOptionsDisabled, setChatOptions } = controller;
  const options = resolveChatOptions(chat.options, config?.settings);
  const available = serverDetails?.reasoningSupported === true;
  const label = !available
    ? 'Unavailable'
    : options.reasoning === 'auto'
      ? 'Default'
      : options.reasoning === 'off'
        ? 'Off'
        : options.effort === 'auto'
          ? 'On'
          : options.effort.charAt(0).toUpperCase() + options.effort.slice(1);
  return (
    <Popover
      label="Reasoning"
      valueLabel={label}
      className={`reasoning-menu ${available && options.reasoning === 'on' ? 'is-on' : ''}`}
      disabled={chatOptionsDisabled || !available}
      trigger={
        <>
          <Lightbulb size={14} />
          <span>Reasoning</span>
          <span className="chip-value">{label}</span>
          <ChevronDown size={12} />
        </>
      }
    >
      {() => (
        <ReasoningControls
          disabled={chatOptionsDisabled}
          effortPresentation="segments"
          reasoning={options.reasoning}
          effort={options.effort}
          details={serverDetails}
          onReasoning={(reasoning) => setChatOptions({ reasoning })}
          onEffort={(effort) => setChatOptions({ effort })}
        />
      )}
    </Popover>
  );
}
