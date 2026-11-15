import { Globe } from 'lucide-react';
import Popover from '../../components/Popover';
import type { WorkspaceController } from '../../app/useWorkspace';

export default function WebSearchMenu({ controller }: { controller: WorkspaceController }) {
  const { webSearch: search, webSearchOn: on, setWebSearchOn: setOn } = controller;
  const { status, provider, preferences, maxSearches } = search;
  const saved = !!status?.saved;
  const quota = status?.quota;
  const remaining =
    quota?.limit !== null && quota?.limit !== undefined
      ? Math.max(0, quota.limit - quota.used)
      : null;
  const title = !saved
    ? `Web search needs a ${provider?.name ?? 'search service'} API key`
    : `${on ? 'Web search is on' : 'Turn on web search'} for this message${remaining !== null ? ` · ${remaining.toLocaleString('en-US')} credits left this month` : ' · usage unavailable'}`;
  return (
    <Popover
      label="Web search"
      title={title}
      pressed={on}
      className={`web-search-menu ${on ? 'is-on' : ''} ${!saved ? 'is-unavailable' : ''}`}
      disabled={controller.chatOptionsDisabled || !!controller.currentProject?.archived || !status}
      containFocus
      heading={
        !saved
          ? `Web search needs a ${provider?.name ?? 'search service'} API key`
          : 'Web search is on for this message'
      }
      trigger={
        <>
          <Globe size={14} />
          <span>Web search</span>
          {on && <span className="chip-value">On</span>}
        </>
      }
      onTrigger={() => {
        if (!saved) return true;
        setOn(!on);
        return !on && !preferences.webSearchNoticeSeen;
      }}
    >
      {(close) =>
        !saved ? (
          <>
            <p>{provider?.planDescription} You add the key once, in Settings.</p>
            {search.error && <p role="status">{search.error}</p>}
            <div className="row-actions">
              <button type="button" onClick={close}>
                Not now
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  close();
                  controller.reviewSettings('websearch');
                }}
              >
                Add API key
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Straggler sends your search queries to {provider?.name ?? 'the search service'}. The
              conversation itself stays on this computer.
            </p>
            <p>
              The model can search up to {maxSearches} times, {provider?.searchCostDescription}. Web
              search turns off again after you send.
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                search.onPreferences({ webSearchNoticeSeen: true });
                close();
              }}
            >
              Got it
            </button>
          </>
        )
      }
    </Popover>
  );
}
