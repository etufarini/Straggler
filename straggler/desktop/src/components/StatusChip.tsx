import { Check, Circle, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export default function StatusChip({
  children,
  tone = 'neutral',
  live = false,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'attention';
  live?: boolean;
}) {
  const Icon = tone === 'positive' ? Check : tone === 'attention' ? CircleAlert : Circle;
  return (
    <span className={`status-chip ${tone}`} role={live ? 'status' : undefined}>
      <Icon size={12} aria-hidden="true" />
      {children}
    </span>
  );
}
