import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export default function SettingsHeader({
  title,
  scope,
  group,
  children,
}: {
  title: string;
  scope: string;
  group?: { label: string; icon: LucideIcon };
  children?: ReactNode;
}) {
  const header = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const element = header.current;
    const marker = sentinel.current;
    const root = element?.closest<HTMLElement>('.settings-page');
    if (!element || !marker || !root) return;
    const resize = new ResizeObserver(() => {
      root.style.setProperty(
        '--settings-header-height',
        `${element.getBoundingClientRect().height + 16}px`,
      );
    });
    resize.observe(element);
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      root,
    });
    observer.observe(marker);
    return () => {
      resize.disconnect();
      observer.disconnect();
    };
  }, []);
  const Icon = group?.icon;
  return (
    <>
      <div ref={sentinel} className="settings-header-sentinel" />
      <header ref={header} className={`settings-section-heading${stuck ? ' is-stuck' : ''}`}>
        {group && Icon && (
          <div className="settings-eyebrow">
            <Icon size={14} aria-hidden="true" />
            {group.label}
          </div>
        )}
        <h2>{title}</h2>
        <p className="settings-scope field-help">{scope}</p>
        {children}
      </header>
    </>
  );
}
