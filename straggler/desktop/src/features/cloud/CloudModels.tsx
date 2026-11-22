import { Cloud, Check } from 'lucide-react';
import type { WorkspaceController } from '../../app/useWorkspace';
import type { CloudModel, CloudProvider, CloudSelection } from '../../domain/cloudModels';
import { cloudCapabilities } from '../../domain/cloudModels';
import Feedback from '../../components/Feedback';

export default function CloudModels({
  controller,
  groups,
  selection,
  onSelect,
  query,
}: {
  controller: WorkspaceController;
  groups: { provider: CloudProvider; models: CloudModel[] }[];
  selection: CloudSelection | null;
  onSelect: (selection: CloudSelection) => void;
  query: string;
}) {
  const cloud = controller.cloud;
  const configured = cloud.status.providers.some((provider) => provider.saved);
  const unavailable = controller.generating || controller.busy || cloud.busy || !!cloud.notice;
  return (
    <>
      {cloud.error && (
        <Feedback title="Couldn’t load cloud models" details={cloud.error}>
          Your local models remain available.
        </Feedback>
      )}
      {groups.map(({ provider, models }) => (
        <section
          key={provider.id}
          className="model-group is-cloud"
          role="group"
          aria-label={`Cloud · ${provider.name}`}
        >
          <div className="model-group-head">
            <h3>
              <Cloud size={15} aria-hidden="true" />
              Cloud · {provider.name}
            </h3>
            <span>{provider.kind === 'custom' ? 'Not tested by Straggler' : 'Verified'}</span>
          </div>
          <div className="model-list">
            {models.map((model) => {
              const selected =
                selection?.providerId === provider.id && selection.modelId === model.id;
              const inUse =
                cloud.active?.selection.providerId === provider.id &&
                cloud.active.selection.modelId === model.id;
              const capabilities = cloudCapabilities(model);
              return (
                <button
                  key={model.id}
                  className={`model-option${selected ? ' chosen' : ''}`}
                  aria-pressed={selected}
                  data-in-use={inUse || undefined}
                  disabled={unavailable}
                  onClick={() => onSelect({ providerId: provider.id, modelId: model.id })}
                >
                  <Cloud size={19} aria-hidden="true" />
                  <span>
                    {model.name}
                    <small>
                      {[
                        inUse ? 'In use' : '',
                        capabilities.length ? capabilities.join(' · ') : 'Capabilities not listed',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  {selected && <Check size={17} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {!models.length && <p className="field-help">Choose models to show in Settings.</p>}
        </section>
      ))}
      {!configured ? (
        <button className="text-button" onClick={() => controller.reviewSettings('cloud')}>
          Set up cloud models
        </button>
      ) : (
        cloud.status.providers
          .filter(
            (provider) =>
              !provider.saved && (!query || provider.name.toLocaleLowerCase().includes(query)),
          )
          .map((provider) => (
            <button
              key={provider.id}
              className="text-button"
              onClick={() => controller.reviewSettings('cloud', `cloud-provider-${provider.id}`)}
            >
              Set up {provider.name} in Settings
            </button>
          ))
      )}
    </>
  );
}
