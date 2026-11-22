import { useEffect, useRef, useState } from 'react';
import ModelSettings from './ModelSettings';
import MemorySettings from './MemorySettings';
import PerformanceSettings from './PerformanceSettings';
import ServerSettings from './ServerSettings';
import type { SettingsController } from './useSettings';

export function focusSettingsTarget(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  let ancestor = element.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  const control = element.matches('input, button, textarea, select')
    ? element
    : element.querySelector<HTMLElement>('input, button, textarea, select');
  (control ?? element).focus({ preventScroll: true });
  element.scrollIntoView({ block: 'start' });
}

const blocks = [
  { id: 'model-model', label: 'Model', Component: ModelSettings },
  { id: 'model-memory', label: 'Memory', Component: MemorySettings },
  { id: 'model-speed', label: 'Speed', Component: PerformanceSettings },
  { id: 'model-server', label: 'Server', Component: ServerSettings },
];
export default function UnifiedModelSettings({
  controller,
  onManage,
}: {
  controller: SettingsController;
  onManage: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(blocks[0].id);
  useEffect(() => {
    const viewport = root.current?.closest('.settings-section');
    if (!viewport) return;
    const updateCurrent = () => {
      const viewportBounds = viewport.getBoundingClientRect();
      let visible = blocks[0].id;
      let largestVisibleHeight = 0;
      for (const block of blocks) {
        const bounds = document.getElementById(block.id)?.getBoundingClientRect();
        if (!bounds) continue;
        const visibleHeight = Math.max(
          0,
          Math.min(bounds.bottom, viewportBounds.bottom) - Math.max(bounds.top, viewportBounds.top),
        );
        if (visibleHeight > largestVisibleHeight) {
          largestVisibleHeight = visibleHeight;
          visible = block.id;
        }
      }
      setCurrent(visible);
    };
    viewport.addEventListener('scroll', updateCurrent, { passive: true });
    const resize = new ResizeObserver(updateCurrent);
    resize.observe(viewport);
    updateCurrent();
    return () => {
      viewport.removeEventListener('scroll', updateCurrent);
      resize.disconnect();
    };
  }, []);
  return (
    <div ref={root} className="unified-model-settings">
      <nav className="model-settings-index" aria-label="Model settings sections">
        {blocks.map((block) => (
          <a
            key={block.id}
            href={`#${block.id}`}
            aria-current={current === block.id ? 'location' : undefined}
            onClick={(event) => {
              event.preventDefault();
              focusSettingsTarget(block.id);
            }}
          >
            {block.label}
          </a>
        ))}
        <button id="manage-configurations" className="text-button" onClick={onManage}>
          Manage configurations…
        </button>
      </nav>
      {blocks.map(({ id, label, Component }) => (
        <section key={id} id={id} className="model-settings-block" aria-label={label} tabIndex={-1}>
          <div className="settings-note-group">
            <h3>{label}</h3>
            {id === 'model-speed' && (
              <p className="field-help">Auto lets llama.cpp choose for your hardware.</p>
            )}
          </div>
          <Component controller={controller} />
        </section>
      ))}
    </div>
  );
}
