import type { ServerDetails } from './types';

export type CloudKind = 'deepseek' | 'openrouter' | 'mistral' | 'custom';
export interface CloudModel {
  id: string;
  name: string;
  details: ServerDetails;
}
export interface CloudSelection {
  providerId: string;
  modelId: string;
}
export interface CloudProvider {
  id: string;
  name: string;
  baseUrl: string;
  kind: CloudKind;
  models: CloudModel[];
  shown: string[];
  saved: boolean;
  keyError: string | null;
}
export interface ActiveCloud {
  selection: CloudSelection;
  providerName: string;
  baseUrl: string;
  kind: CloudKind;
  model: CloudModel;
}
export interface CloudStatus {
  providers: CloudProvider[];
  active: ActiveCloud | null;
  error: string | null;
}

export function cloudCapabilities(model: CloudModel): string[] {
  const details = model.details;
  return [
    details.contextSize ? `${details.contextSize.toLocaleString('en-US')} context` : '',
    details.visionSupported === true ? 'Vision' : '',
    details.toolsSupported === true ? 'Tools' : '',
    details.reasoningSupported === true ? 'Reasoning' : '',
  ].filter(Boolean);
}
