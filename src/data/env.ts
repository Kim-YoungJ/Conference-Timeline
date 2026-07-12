// Browser fallbacks let the frontend run outside Tauri (dev preview / future web build).
import { openUrl } from '@tauri-apps/plugin-opener';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function openExternal(url: string): void {
  if (isTauri) void openUrl(url);
  else window.open(url, '_blank');
}
