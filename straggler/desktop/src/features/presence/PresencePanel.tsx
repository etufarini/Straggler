import AttachmentSection from '../attachments/AttachmentSection';
import type { AttachmentController } from '../attachments/useAttachments';
import { useEffect, useId, useRef, useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import AssistantPresence from './AssistantPresence';
import type { PresenceState } from '../../domain/presence';
import type { GenerationMetrics, UiPreferences } from '../../domain/types';

export default function PresencePanel({
  state,
  metrics,
  preferences,
  onPreferences,
  ready,
  attachments,
}: {
  state: PresenceState;
  metrics?: GenerationMetrics;
  preferences: UiPreferences;
  onPreferences: (patch: Partial<UiPreferences>) => void;
  ready: boolean;
  attachments: AttachmentController;
}) {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const expanded = preferences.presenceExpanded ?? !narrow;
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-width: 1100px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!expanded || !narrow) return;
    const trigger = button.current;
    function closeKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onPreferences({ presenceExpanded: false });
    }
    function outside(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node))
        onPreferences({ presenceExpanded: false });
    }
    document.addEventListener('keydown', closeKey);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', closeKey);
      document.removeEventListener('pointerdown', outside);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [expanded, narrow, onPreferences]);
  return (
    <div className={`presence-slot ${expanded ? 'is-expanded' : ''} ${narrow ? 'is-narrow' : ''}`}>
      <aside
        ref={panel}
        className={`presence ${expanded ? 'is-expanded' : 'is-compact'}`}
        aria-label="Assistant"
      >
        <button
          ref={button}
          className="presence-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={expanded ? 'Collapse assistant panel' : 'Expand assistant panel'}
          title={expanded ? 'Collapse assistant panel' : 'Expand assistant panel'}
          disabled={!ready}
          onClick={() => onPreferences({ presenceExpanded: !expanded })}
        >
          {expanded ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
        <div id={id}>
          <AssistantPresence state={state} metrics={metrics} />
          <AttachmentSection controller={attachments} />
        </div>
      </aside>
    </div>
  );
}
