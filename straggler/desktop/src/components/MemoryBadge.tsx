import { CircleHelp, CircleCheck, TriangleAlert, Cpu } from 'lucide-react';
import { memoryFit } from '../domain/memory';
import type { Memory } from '../domain/types';

export default function MemoryBadge({
  bytes,
  memory,
  context,
}: {
  bytes?: number | null;
  memory?: Memory;
  context?: string;
}) {
  const label = memoryFit(bytes, memory, context);
  const Icon =
    label === 'Fits in GPU memory'
      ? CircleCheck
      : label === 'Partly on CPU · slower'
        ? Cpu
        : label === 'Likely too large'
          ? TriangleAlert
          : CircleHelp;
  return (
    <span className="memory-badge">
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}
