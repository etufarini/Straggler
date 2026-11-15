import { useLayoutEffect } from 'react';

export default function usePagePrimaryAction(
  active: boolean | null,
  onChange: (active: boolean) => void,
) {
  useLayoutEffect(() => {
    // Independently saved sections can delegate this report to their own primary action.
    if (active === null) return;
    onChange(active);
    return () => onChange(false);
  }, [active, onChange]);
}
