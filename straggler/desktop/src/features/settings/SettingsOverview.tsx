import type { ReactNode } from 'react';
import type { SettingsController } from './useSettings';
import type { CloudController } from '../cloud/useCloudModels';
import type { WebSearchController } from '../websearch/useWebSearch';
import type { HubTokenStatus } from '../../domain/huggingFace';
import { fileName } from '../../domain/types';
import { statusLabel } from '../../components/statusLabels';
import StatusChip from '../../components/StatusChip';
import { usePromptPresets } from '../prompts/PromptPresets';
import { sectionGroups } from './settingsNavigation';

export default function SettingsOverview({
  controller,
  cloud,
  webSearch,
  tokenStatus,
}: {
  controller: SettingsController;
  cloud: CloudController;
  webSearch: WebSearchController;
  tokenStatus: HubTokenStatus | null;
}) {
  const { config, server, setSection } = controller;
  const { presets, ready } = usePromptPresets();
  const settings = config.settings;
  const services = cloud.status.providers.filter((provider) => provider.saved);
  const missingModel = !config.models.some((model) => model.path === settings.model);
  const data: Record<string, { value: string; detail?: string; status?: ReactNode; link: string }> =
    {
      'chat-defaults': {
        value: settings.chat_system_prompt
          ? 'Default system prompt set'
          : 'No default system prompt',
        detail: `Reasoning: ${settings.chat_reasoning} · Replies: ${config.generationPreset}`,
        link: 'Edit chat defaults',
      },
      prompts: {
        value: !ready
          ? 'Presets unavailable'
          : !presets.length
            ? 'No presets yet'
            : `${presets.length} ${presets.length === 1 ? 'preset' : 'presets'}`,
        link: 'Manage system prompts',
      },
      model: {
        value: settings.model ? fileName(settings.model) : 'No model selected',
        detail: `${config.currentProfile || 'Custom settings'} · Context: ${settings.context} · GPU layers: ${settings.device === 'none' ? 'CPU only' : settings.gpu_layers}`,
        status: (
          <StatusChip
            tone={
              server.phase === 'ready'
                ? 'positive'
                : server.phase === 'error'
                  ? 'attention'
                  : 'neutral'
            }
          >
            {statusLabel[server.phase]}
          </StatusChip>
        ),
        link: 'Edit model settings',
      },
      llama: {
        value: config.serverAvailable
          ? config.llamaDir
            ? 'External build'
            : 'Bundled backend'
          : 'No backend found',
        detail: [
          config.build?.version || config.build?.tag,
          config.llamaDir || 'Bundled with Straggler',
        ]
          .filter(Boolean)
          .join(' · '),
        status: (
          <StatusChip tone={config.serverAvailable ? 'positive' : 'attention'}>
            {config.serverAvailable ? 'Found' : 'Unavailable'}
          </StatusChip>
        ),
        link: 'Manage llama.cpp',
      },
      'model-files': {
        value: config.modelsDir || 'No models folder selected',
        detail: `Hugging Face token: ${tokenStatus === null ? 'status unavailable' : tokenStatus.saved ? 'saved' : tokenStatus.available === false ? 'status unavailable' : 'none (optional)'}`,
        link: 'Manage model files',
      },
      cloud: {
        value: `${services.length} of ${cloud.status.providers.length} services set up`,
        detail: services.length
          ? services.map((service) => service.name).join(', ')
          : 'No cloud services set up',
        link: 'Set up cloud models',
      },
      websearch: {
        value: webSearch.status?.saved
          ? `${webSearch.provider?.name || 'Web search'} · ${webSearch.maxSearches} ${webSearch.maxSearches === 1 ? 'search' : 'searches'} per message`
          : 'Off until you add a key',
        link: 'Set up web search',
      },
    };
  return (
    <div className="settings-overview">
      {(missingModel || !config.serverAvailable) && (
        <section className="overview-attention" aria-label="Needs attention">
          <h3>Needs attention</h3>
          {missingModel && (
            <button className="text-button" onClick={() => setSection('model-files')}>
              Choose a models folder
            </button>
          )}
          {!config.serverAvailable && (
            <button className="text-button" onClick={() => setSection('llama')}>
              Select a llama.cpp build
            </button>
          )}
        </section>
      )}
      {sectionGroups.map((group) => (
        <section className="overview-group" key={group.label} aria-label={group.label}>
          <h3 className="settings-eyebrow">
            <group.icon size={14} aria-hidden="true" />
            {group.label}
          </h3>
          <div className="overview-cards">
            {group.sections.map((entry) => {
              const card = data[entry.id];
              return (
                <button
                  key={entry.id}
                  className={`overview-card${entry.id === 'model' ? ' wide' : ''}`}
                  onClick={() => setSection(entry.id)}
                >
                  <span className="overview-card-title">
                    <entry.icon size={16} aria-hidden="true" />
                    {entry.label}
                    {card.status}
                  </span>
                  <strong>{card.value}</strong>
                  {card.detail && <small>{card.detail}</small>}
                  <span className="overview-card-link">{card.link} →</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
