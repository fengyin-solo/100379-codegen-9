import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries:v2'
const KV_KEY = 'hydrology-monitor-station:kv:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let kvCache: Record<string, unknown> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 通用 KV：口径版本、归档快照、复核事项、编辑锁这些整编附属数据放这里。 */
export function readKv(): Record<string, unknown> {
  if (kvCache !== null) {
    return kvCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    kvCache = {}
    return kvCache
  }
  const raw = window.localStorage.getItem(KV_KEY)
  if (!raw) {
    kvCache = {}
    return kvCache
  }
  try {
    kvCache = JSON.parse(raw) as Record<string, unknown>
  } catch {
    kvCache = {}
  }
  return kvCache
}

export function getKv<T>(key: string, fallback: T): T {
  const store = readKv()
  return (key in store ? (store[key] as T) : fallback)
}

export function setKv<T>(key: string, value: T): void {
  const next = { ...readKv(), [key]: value }
  kvCache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(KV_KEY, JSON.stringify(next))
  }
}

/** 跨标签页并发：另一个页面写入时清掉内存缓存，下一次读取拿到最新版本。 */
export function dropCaches(): void {
  cache = null
  kvCache = null
}

let storageListenerBound = false

/** 注册一次 storage 监听：别的标签页提交后，本页能感知版本变化并重取数据。 */
export function bindStorageSync(onRemoteChange?: () => void): void {
  if (storageListenerBound || typeof window === 'undefined' || !window.addEventListener) {
    return
  }
  storageListenerBound = true
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === KV_KEY) {
      dropCaches()
      onRemoteChange?.()
    }
  })
}
