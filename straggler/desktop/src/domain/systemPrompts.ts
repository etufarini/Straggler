export interface PresetText {
  name: string;
  description: string;
  prompt: string;
}

export interface SystemPromptPreset extends PresetText {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export function systemPromptError(text: string): string | undefined {
  if (new TextEncoder().encode(text).length > 65536 || text.includes('\0'))
    return 'Use at most 65536 UTF-8 bytes without NUL characters.';
}

export function availablePresetName(name: string, presets: SystemPromptPreset[]): string {
  const taken = (name: string) =>
    presets.some((preset) => preset.name.toLowerCase() === name.toLowerCase());
  name = name.trim();
  if (!taken(name)) return name;
  for (let index = 2; ; index++) {
    const suffix = ` (${index})`;
    const candidate = `${Array.from(name)
      .slice(0, 80 - suffix.length)
      .join('')
      .trimEnd()}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
}
