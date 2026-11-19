import { useLayoutEffect, useRef } from 'react';

const hysteresis = 16;

export default function useTopbarDensity() {
  const topbar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = topbar.current;
    const model = bar?.querySelector<HTMLElement>('.model-switch');
    const controls = bar?.querySelector<HTMLElement>('.header-controls');
    if (!bar || !model || !controls) return;
    let density: 'full' | 'icon' = 'full';
    let disposed = false;

    function measure() {
      if (!bar || !model || !controls || disposed) return;
      const vision = model.querySelector<HTMLElement>('.vision-badge');
      if (vision) vision.style.display = '';
      const temporary = controls.querySelector<HTMLElement>('.temp-toggle, .temp-status');
      const style = getComputedStyle(bar);
      const available =
        bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);

      // Measure the real controls at their natural width, then restore them before paint.
      // The model may shrink only after choosing the Temporary presentation.
      const previousWidth = model.style.width;
      const previousShrink = model.style.flexShrink;
      model.style.width = 'max-content';
      model.style.flexShrink = '0';
      if (temporary) temporary.dataset.density = 'full';
      const required =
        model.getBoundingClientRect().width +
        controls.getBoundingClientRect().width +
        parseFloat(style.columnGap);
      if (vision && required > available) vision.style.display = 'none';
      model.style.width = previousWidth;
      model.style.flexShrink = previousShrink;

      if (required > available) density = 'icon';
      else if (required + hysteresis <= available) density = 'full';
      if (temporary) temporary.dataset.density = density;
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(model);
    observer.observe(controls);
    const mutations = new MutationObserver(measure);
    mutations.observe(bar, { childList: true, characterData: true, subtree: true });
    void document.fonts.ready.then(measure);
    return () => {
      disposed = true;
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);
  return topbar;
}
