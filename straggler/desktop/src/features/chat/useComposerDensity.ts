import { useLayoutEffect, useRef } from 'react';

const densities = ['full', 'compact', 'icon', 'wrap'] as const;
const hysteresis = 16;

export default function useComposerDensity() {
  const composer = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    const form = composer.current;
    const footer = form?.querySelector<HTMLElement>('.composer-footer');
    const tools = form?.querySelector<HTMLElement>('.composer-tools');
    const send = form?.querySelector<HTMLElement>('.composer-send');
    if (!form || !footer || !tools || !send) return;
    let current = 0;
    let disposed = false;

    function measure() {
      if (!form || !footer || !tools || !send || disposed) return;
      form.dataset.narrow = String(form.clientWidth <= 900);
      const style = getComputedStyle(footer);
      const available =
        footer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap);
      // Measure the real controls in each presentation, without duplicating focusable DOM.
      // All presentations are restored synchronously, before the browser paints.
      const widths = densities.slice(0, 3).map((density) => {
        form.dataset.density = density;
        return tools.getBoundingClientRect().width + send.getBoundingClientRect().width + gap;
      });
      let next = current;
      while (next < 3 && widths[next] > available) next++;
      while (next > 0 && widths[next - 1] + hysteresis <= available) next--;
      current = next;
      form.dataset.density = densities[current];
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    observer.observe(send);
    for (const chip of tools.querySelectorAll('.composer-chip')) observer.observe(chip);
    const mutations = new MutationObserver(measure);
    mutations.observe(footer, { childList: true, characterData: true, subtree: true });
    void document.fonts.ready.then(measure);
    return () => {
      disposed = true;
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);
  return composer;
}
