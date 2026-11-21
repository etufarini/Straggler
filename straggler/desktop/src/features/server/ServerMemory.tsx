import { Cpu } from 'lucide-react';
import type { WorkspaceController } from '../../app/useWorkspace';
import { offloadedLayers } from '../../domain/memory';
import { statusLabel } from '../../components/statusLabels';

export default function ServerMemory({ controller }: { controller: WorkspaceController }) {
  const { server, serverDetails, config } = controller;
  const actual = serverDetails?.runId === server.runId ? serverDetails?.contextSize : null;
  const requested = Number(server.runningSettings?.context);
  return (
    <section className="server-memory" aria-label="Memory">
      <h3>
        <Cpu size={16} aria-hidden="true" />
        Memory <span className="memory-badge">{statusLabel[server.phase]}</span>
      </h3>
      <dl>
        <dt>Layers on the GPU</dt>
        <dd>{offloadedLayers(server.logs)}</dd>
        <dt>Context</dt>
        <dd>
          {actual?.toLocaleString('en-US') ?? '—'}
          {actual && requested > actual
            ? ` · reduced from ${requested.toLocaleString('en-US')}`
            : ''}
        </dd>
        <dt>Detected devices</dt>
        <dd>{config?.devices.map((device) => device.label).join(' · ') || '—'}</dd>
      </dl>
      <button
        className="text-button"
        onClick={() => controller.reviewSettings('model', 'context-size')}
      >
        Model settings
      </button>
    </section>
  );
}
