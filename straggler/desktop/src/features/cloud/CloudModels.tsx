import { useState } from 'react';
import { Cloud, Check } from 'lucide-react';
import type { WorkspaceController } from '../../app/useWorkspace';
import type { CloudSelection } from '../../domain/cloudModels';
import { cloudCapabilities, shownCloudModels } from '../../domain/cloudModels';
import Feedback from '../../components/Feedback';

export default function CloudModels({ controller }: { controller: WorkspaceController }) {
  const cloud = controller.cloud;
  const [selection, setSelection] = useState<CloudSelection | null>(
    cloud.active?.selection ?? null,
  );
  const configured = cloud.status.providers.some((provider) => provider.saved);
  const unavailable = controller.generating || cloud.busy || !!cloud.notice;
  return (
    <>
      {cloud.error && (
        <Feedback title="Couldn’t load cloud models" details={cloud.error}>
          Your local models remain available.
        </Feedback>
      )}
      {!configured && (
        <div className="empty-models">
          <Cloud size={28} />
          <h3>No cloud services configured</h3>
          <p>Add a key for a service in Settings, then choose which models to show.</p>
          <button className="primary-button" onClick={() => controller.reviewSettings('cloud')}>
            Set up cloud models
          </button>
        </div>
      )}
      {configured &&
        cloud.status.providers.map((provider) => (
          <section key={provider.id} className="cloud-model-group">
            <div className="project-section-head">
              <h3>{provider.name}</h3>
              <span className="cloud-verified">
                {provider.kind === 'custom' ? 'Not tested by Straggler' : 'Verified'}
              </span>
            </div>
            {provider.saved ? (
              <>
                {shownCloudModels(provider).map((model) => {
                  const selected =
                    selection?.providerId === provider.id && selection.modelId === model.id;
                  const capabilities = cloudCapabilities(model);
                  return (
                    <button
                      key={model.id}
                      className={`model-option${selected ? ' chosen' : ''}`}
                      disabled={unavailable}
                      onClick={() => setSelection({ providerId: provider.id, modelId: model.id })}
                    >
                      <Cloud size={19} />
                      <span>
                        {model.name}
                        <small>
                          {capabilities.length
                            ? capabilities.join(' · ')
                            : 'Capabilities not listed'}
                        </small>
                      </span>
                      {selected && <Check size={17} />}
                    </button>
                  );
                })}
                {!shownCloudModels(provider).length && (
                  <p className="field-help">Choose models to show in Settings.</p>
                )}
              </>
            ) : (
              <button className="text-button" onClick={() => controller.reviewSettings('cloud')}>
                Set up {provider.name} in Settings
              </button>
            )}
          </section>
        ))}
      <p className="capability-note">
        Using a cloud model stops the local server and frees its memory. Choose a model on this
        computer to load it again.
      </p>
      {controller.generating && (
        <p className="field-help">Available when the current response finishes or is stopped.</p>
      )}
      {configured && (
        <div className="panel-actions">
          <button
            className="primary-button"
            disabled={unavailable || !selection}
            onClick={() => selection && void controller.useCloudModel(selection).catch(() => {})}
          >
            Use model
          </button>
        </div>
      )}
    </>
  );
}
