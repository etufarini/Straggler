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
  const Icon = group?.icon;
  return (
    <header className="settings-section-heading">
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
  );
}
