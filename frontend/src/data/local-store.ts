import { SEED_ROWS } from './seed'
import type { CompilationCaliber, EntryRow, ReviewItem } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const CALIBER_KEY = 'hydrology-monitor-station:compilation-caliber'
const REVIEWS_KEY = 'hydrology-monitor-station:compilation-reviews'

// 整编汇总口径的默认值：缺整编类型的旧年度成果统一归入「综合整编」。
export const DEFAULT_CALIBER: CompilationCaliber = {
  version: 1,
  pendingScope: 'pendingOnly',
  includeRejectedRaw: true,
  fallbackType: '综合整编',
}

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

// 写操作前重读一次存储：别的页面/标签页刚提交的内容要先合进来，版本校验才靠得住。
export function refreshRows(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  cache = readStorage()
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return clone(fallback)
  }
  try {
    return { ...clone(fallback), ...(JSON.parse(raw) as T) }
  } catch {
    return clone(fallback)
  }
}

export function loadCaliber(): CompilationCaliber {
  return readJson<CompilationCaliber>(CALIBER_KEY, DEFAULT_CALIBER)
}

export function saveCaliber(caliber: CompilationCaliber): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CALIBER_KEY, JSON.stringify(caliber))
  }
}

export function loadReviews(): ReviewItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(REVIEWS_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as ReviewItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveReviews(items: ReviewItem[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REVIEWS_KEY, JSON.stringify(items))
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}
