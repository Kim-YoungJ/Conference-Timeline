// Thin plugin-store wrapper around the single `user` key.
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Conference, Journal, UserData } from './types';
import customSeed from './seed/custom-conferences.json';
import journalSeed from './seed/journals.json';
import { isTauri } from './env';

// localStorage fallback so the frontend runs in a plain browser too
const webStore = {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = localStorage.getItem(`ct-${key}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    localStorage.setItem(`ct-${key}`, JSON.stringify(value));
  },
};

let store: Store | null = null;
async function getStore(): Promise<Store | typeof webStore> {
  if (!isTauri) return webStore;
  if (!store) store = await load('store.json', { autoSave: true, defaults: {} });
  return store;
}

export async function loadUser(): Promise<UserData> {
  const s = await getStore();
  const existing = await s.get<UserData>('user');
  if (existing) return existing;
  // first run: seed customs (CDC/ACC/AIAA/IAC) and journals into user data — user-editable from then on
  const fresh: UserData = {
    tracked: [],
    customConferences: customSeed as Conference[],
    journals: journalSeed as Journal[],
    submissions: [],
  };
  await s.set('user', fresh);
  return fresh;
}

export async function saveUser(user: UserData): Promise<void> {
  await (await getStore()).set('user', user);
}
