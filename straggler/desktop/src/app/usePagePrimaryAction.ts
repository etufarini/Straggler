import { useLayoutEffect } from 'react';

export default function usePagePrimaryAction(
  active: boolean | null,
  onChange: (active: boolean) => void,
) {
  useLayoutEffect(() => {
    if (active === null) return;
    onChange(active);
    return () => onChange(false);
  }, [active, onChange]);
}
