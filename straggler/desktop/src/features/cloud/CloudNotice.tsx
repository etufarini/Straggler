import { useEffect, useRef } from 'react';
import type { CloudController } from './useCloudModels';
import { containTabFocus } from '../../components/focus';
import Feedback from '../../components/Feedback';

export default function CloudNotice({ controller }: { controller: CloudController }) {
  const panel = useRef<HTMLElement>(null);
  const cancel = useRef(controller.cancelNotice);
  cancel.current = controller.cancelNotice;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel.current();
      } else containTabFocus(event, panel.current);
    }
    function outside(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) cancel.current();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keydown, true);
      previous?.focus();
    };
  }, []);
  const provider = controller.notice;
  if (!provider) return null;
  return (
    <section
      className="composer-popover cloud-notice"
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-notice-title"
    >
      <h3 id="cloud-notice-title">Send this chat to {provider.providerName}?</h3>
      <p>
        Messages, project files and attachments in this chat are sent to {provider.providerName}.
        Your saved chats stay on this computer.
      </p>
      <p>{provider.providerName}’s own terms apply to what it receives.</p>
      {provider.kind === 'custom' && <p className="popover-note">Service: {provider.baseUrl}</p>}
      {controller.noticeError && (
        <Feedback title="Couldn’t save the acknowledgement" details={controller.noticeError}>
          No message has been sent. Try again.
        </Feedback>
      )}
      <div className="popover-actions">
        <button disabled={controller.noticeBusy} onClick={controller.cancelNotice}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={controller.noticeBusy}
          onClick={() => void controller.continueNotice()}
        >
          Continue
        </button>
      </div>
    </section>
  );
}
