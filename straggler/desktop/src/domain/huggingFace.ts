export interface HubFile {
  path: string;
  size: number;
  sha256: string | null;
}
export interface HubVariant {
  path: string;
  label: string;
  size: number;
  parts: number;
  error: string | null;
}
export interface HubRepository {
  id: string;
  revision: string;
  files: HubFile[];
  variants: HubVariant[];
  gated: boolean;
  warning: string | null;
  suggestedFile: string | null;
}
export interface HubSearch {
  repositories: { id: string; downloads: number; gated: boolean }[];
  direct: HubRepository | null;
  warning: string | null;
}
export interface HubDownload {
  id: string;
  plan: { repository: string; revision: string; files: HubFile[] };
  root: string;
  phase:
    | 'downloading'
    | 'verifying'
    | 'pausing'
    | 'paused'
    | 'cancelling'
    | 'cancelled'
    | 'completed'
    | 'error';
  downloaded: number;
  total: number;
  error: string | null;
}
export interface HubTokenStatus {
  saved: boolean;
  available: boolean;
  error: string | null;
}
export interface ModelsFolderInfo {
  path: string;
  defaultPath: string;
  freeBytes: number | null;
  error: string | null;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : `${bytes.toLocaleString('en-US')} bytes`;
}
