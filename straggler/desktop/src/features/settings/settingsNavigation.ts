import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  Cpu,
  Server,
  Folder,
  Cloud,
  Globe,
  Layers,
  HardDrive,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Section } from './sections';

type Entry = { id: Section; label: string; icon: LucideIcon };
export const overviewEntry: Entry = { id: 'overview', label: 'Overview', icon: LayoutDashboard };
export const sectionGroups: { label: string; icon: LucideIcon; sections: Entry[] }[] = [
  {
    label: 'All models',
    icon: Layers,
    sections: [
      { id: 'chat-defaults', label: 'Chat defaults', icon: MessageSquare },
      { id: 'prompts', label: 'System prompts', icon: FileText },
    ],
  },
  {
    label: 'On this computer',
    icon: HardDrive,
    sections: [
      { id: 'model', label: 'Model settings', icon: Cpu },
      { id: 'llama', label: 'llama.cpp', icon: Server },
      { id: 'model-files', label: 'Model files', icon: Folder },
    ],
  },
  {
    label: 'Cloud and web',
    icon: Cloud,
    sections: [
      { id: 'cloud', label: 'Cloud models', icon: Cloud },
      { id: 'websearch', label: 'Web search', icon: Globe },
    ],
  },
];
