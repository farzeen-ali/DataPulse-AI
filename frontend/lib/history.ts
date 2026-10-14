"use client";

import { useSyncExternalStore } from "react";

/** Recent questions — a per-browser convenience, safe to lose. */
export interface HistoryItem {
  id: string;
  prompt: string;
  status: string;
  rowCount: number;
  at: string;
}

const KEY = "datapulse.history.v1";
const MAX = 12;
const EMPTY: HistoryItem[] = [];
const listeners = new Set<() => void>();
let cache: HistoryItem[] | null = null;

function read(): HistoryItem[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as HistoryItem[]).slice(0, MAX) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: HistoryItem[]) {
  cache = items;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable (private mode) — keep in memory only */
  }
  listeners.forEach((l) => l());
}

export function addHistory(item: HistoryItem) {
  const rest = read().filter((h) => h.prompt.toLowerCase() !== item.prompt.toLowerCase());
  write([item, ...rest].slice(0, MAX));
}

export function clearHistory() {
  write([]);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useHistory(): HistoryItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
