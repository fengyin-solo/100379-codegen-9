import { getKv, listRows, saveRows, setKv } from '@/data/local-store'
import {
  CALIBERS,
  COMPILATION_FLOW,
  type ArchiveSnapshot,
  type BoardCell,
  type CaliberMeta,
  type CaliberVersion,
  type CellMetrics,
  type CompilationAction,
  type CompilationRow,
  type ReviewItem,
  cellKey,
  caliberOf,
  isCompilationRow,
  resolveCompilationType,
  summarizeRows,
} from '@/data/compilation'
import type { ActionResult } from '@/data/types'

const COMPILATION_KEY = 'compilation'
const CALIBER_KV = 'compilation:caliber'
const ARCHIVES_KV = 'compilation:archives'
const REVIEWS_KV = 'compilation:reviews'
const LOCK_PREFIX = 'compilation:lock:'
const LOCK_TTL_MS = 8000

/** 看板固定展示的整编站点，巡检入口找不到站点时也会落到对应年份的格子上。 */
export const BOARD_STATIONS: { code: string; name: string }[] = [
  { code: 'ST1001', name: '兰溪水文站' },
  { code: 'ST1002', name: '分水江水文站' },
  { code: 'ST1003', name: '佛子岭水文站' },
  { code: 'ST1004', name: '梅溪水库站' },
  { code: 'ST1005', name: '青山水文站' },
]

export function stationName(code: string): string {
  return BOARD_STATIONS.find((item) => item.code === code)?.name ?? code
}

function readCompilationRows(): CompilationRow[] {
  return listRows(COMPILATION_KEY)
    .filter(isCompilationRow)
    .map((row) => ({
      ...row,
      version: typeof row.version === 'number' ? row.version : 1,
      整编类型: resolveCompilationType(row),
      原始记录数: Number(row.原始记录数) || 0,
    }))
}

function writeCompilationRows(rows: CompilationRow[]): void {
  saveRows(COMPILATION_KEY, rows as CompilationRow[])
}

/* ---------------- 汇总口径 ---------------- */

export function currentCaliber(): CaliberVersion {
  return getKv<CaliberVersion>(CALIBER_KV, 'v1-2023')
}

export function caliberList(): CaliberMeta[] {
  return CALIBERS
}

/**
 * 切换汇总口径：仅影响未归档格子——看板按新口径实时重算；
 * 已归档格子继续沿用归档快照里当时的口径，不受影响。
 */
export function changeCaliber(version: CaliberVersion): void {
  caliberOf(version)
  setKv(CALIBER_KV, version)
}

/* ---------------- 归档快照 ---------------- */

function readArchives(): Record<string, ArchiveSnapshot> {
  return getKv<Record<string, ArchiveSnapshot>>(ARCHIVES_KV, {})
}

export function archiveOf(year: string, station: string): ArchiveSnapshot | undefined {
  return readArchives()[cellKey({ year, station })]
}

/** 归档：以「当前口径」冻结三项指标，之后切口径不再重算该格。 */
export function archiveCell(year: string, station: string, operator: string): ActionResult {
  const rows = rowsOfCell(year, station)
  const metrics = summarizeRows(rows, currentCaliber())
  if (rows.length === 0) {
    return { ok: false, message: '该格子还没有整编成果，无法归档' }
  }
  const snapshot: ArchiveSnapshot = {
    ...metrics,
    archivedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    operator,
    year,
    station,
  }
  const archives = readArchives()
  archives[cellKey({ year, station })] = snapshot
  setKv(ARCHIVES_KV, archives)
  return { ok: true, message: `已按「${caliberOf(metrics.caliber).label}」归档 ${year}·${stationName(station)}` }
}

/** 取消归档后，格子回到实时口径参与重算。 */
export function unarchiveCell(year: string, station: string): ActionResult {
  const archives = readArchives()
  const key = cellKey({ year, station })
  if (!(key in archives)) {
    return { ok: false, message: '该格子没有归档快照' }
  }
  delete archives[key]
  setKv(ARCHIVES_KV, archives)
  return { ok: true, message: '已取消归档，指标恢复为当前口径实时值' }
}

/* ---------------- 复核事项 ---------------- */

function readReviews(): ReviewItem[] {
  return getKv<ReviewItem[]>(REVIEWS_KV, [])
}

export function listReviews(openOnly = false): ReviewItem[] {
  const items = readReviews()
  return openOnly ? items.filter((item) => item.open) : items
}

function reviewsByCell(): Map<string, ReviewItem[]> {
  const map = new Map<string, ReviewItem[]>()
  for (const item of readReviews()) {
    if (!item.open) {
      continue
    }
    const key = cellKey({ year: item.year, station: item.station })
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      map.set(key, [item])
    }
  }
  return map
}

export function reviewsOfCell(year: string, station: string): ReviewItem[] {
  return reviewsByCell().get(cellKey({ year, station })) ?? []
}

/**
 * 别的巡检入口生成复核事项：根据巡检记录站点，找到该站点最近整编年份；
 * 站点暂无整编成果时落到当前年度，保证看板格子上能看到待复核标记。
 */
export function createReviewFromInspection(input: {
  sourceId: number
  sourceCode: string
  station: string
  content: string
  operator: string
}): ReviewItem {
  const year =
    readCompilationRows()
      .filter((row) => row.站点编号 === input.station)
      .map((row) => Number(row.整编年份))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0]
      ?.toString() ?? new Date().getFullYear().toString()
  const items = readReviews()
  // 同一条巡检记录在复核事项关闭前不重复生成，避免多次点击刷出多条。
  if (items.some((item) => item.sourceId === input.sourceId && item.module === 'inspection' && item.open)) {
    const existing = items.find(
      (item) => item.sourceId === input.sourceId && item.module === 'inspection' && item.open,
    )!
    return existing
  }
  const nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const review: ReviewItem = {
    id: nextId,
    module: 'inspection',
    sourceId: input.sourceId,
    sourceCode: input.sourceCode,
    station: input.station,
    year,
    content: input.content,
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    operator: input.operator,
    open: true,
  }
  setKv(REVIEWS_KV, [review, ...items])
  return review
}

export function closeReview(id: number): ActionResult {
  const items = readReviews()
  const target = items.find((item) => item.id === id)
  if (!target) {
    return { ok: false, message: '没有找到这条复核事项' }
  }
  setKv(
    REVIEWS_KV,
    items.map((item) => (item.id === id ? { ...item, open: false } : item)),
  )
  return { ok: true, message: '复核事项已关闭' }
}

/* ---------------- 看板聚合 ---------------- */

function rowsOfCell(year: string, station: string): CompilationRow[] {
  return readCompilationRows().filter(
    (row) => String(row.整编年份) === year && row.站点编号 === station,
  )
}

export type BoardResult = {
  years: string[]
  stations: { code: string; name: string }[]
  cells: Map<string, BoardCell>
  totals: CellMetrics
  caliber: CaliberMeta
  legacyCount: number
}

/**
 * 年度成果看板：年份为行、站点为列。
 * 已归档格子展示归档当时的快照口径；未归档格子按当前口径实时汇总。
 * 有未关闭复核事项但暂无成果的格子也会出现，方便下钻处理。
 */
export function loadBoard(): BoardResult {
  const caliber = caliberOf(currentCaliber())
  const rows = readCompilationRows()
  const years = [...new Set(rows.map((row) => String(row.整编年份)))].sort((a, b) => Number(b) - Number(a))
  const stationCodes = BOARD_STATIONS.map((item) => item.code)
  const reviews = reviewsByCell()
  const cells = new Map<string, BoardCell>()
  const totals: CellMetrics = { raw: 0, pending: 0, published: 0, caliber: caliber.version }
  let legacyCount = 0

  for (const year of years) {
    for (const station of stationCodes) {
      const cellRows = rows.filter(
        (row) => String(row.整编年份) === year && row.站点编号 === station,
      )
      const key = cellKey({ year, station })
      const openReviews = reviews.get(key)?.length ?? 0
      const archive = archiveOf(year, station)
      if (cellRows.length === 0 && openReviews === 0) {
        continue
      }
      legacyCount += cellRows.filter((row) => resolveCompilationType(row).includes('历史补录')).length
      let metrics: { raw: number; pending: number; published: number }
      let snapshot: ArchiveSnapshot | undefined
      if (archive) {
        snapshot = archive
        metrics = { raw: archive.raw, pending: archive.pending, published: archive.published }
      } else {
        metrics = summarizeRows(cellRows, caliber.version)
      }
      cells.set(key, {
        year,
        station,
        ...metrics,
        count: cellRows.length,
        openReviews,
        archive: snapshot,
        reviewOnly: cellRows.length === 0,
      })
      totals.raw += metrics.raw
      totals.pending += metrics.pending
      totals.published += metrics.published
    }
  }

  // 仅有复核事项、年份不在整编年份列表里的格子也要补进看板。
  for (const [key, bucket] of reviews) {
    if (cells.has(key)) {
      continue
    }
    const [year, station] = key.split('__')
    cells.set(key, {
      year,
      station,
      raw: 0,
      pending: 0,
      published: 0,
      count: 0,
      openReviews: bucket.length,
      reviewOnly: true,
    })
    if (!years.includes(year)) {
      years.push(year)
      years.sort((a, b) => Number(b) - Number(a))
    }
  }

  return { years, stations: BOARD_STATIONS, cells, totals, caliber, legacyCount }
}

/* ---------------- 下钻清单 ---------------- */

export type DrillFilter = { metric?: 'raw' | 'pending' | 'published' }

export type DrillResult = {
  year: string
  station: string
  rows: CompilationRow[]
  reviews: ReviewItem[]
  archive?: ArchiveSnapshot
  caliber: CaliberMeta
}

/** 下钻：取某年某站的成果清单；点不同指标列时按当前口径预过滤。 */
export function loadDrill(year: string, station: string, filter: DrillFilter = {}): DrillResult {
  const all = rowsOfCell(year, station)
  const caliber = caliberOf(currentCaliber())
  let rows = all
  if (filter.metric === 'pending') {
    rows = all.filter((row) => caliber.pendingStatuses.includes(String(row.status)))
  } else if (filter.metric === 'published') {
    rows = all.filter((row) => String(row.status) === '已刊印')
  }
  return {
    year,
    station,
    rows,
    reviews: reviewsOfCell(year, station),
    archive: archiveOf(year, station),
    caliber,
  }
}

/* ---------------- 乐观锁与动作流转 ---------------- */

type LockInfo = { token: string; at: number }

function readLock(id: number): LockInfo | null {
  return getKv<LockInfo | null>(`${LOCK_PREFIX}${id}`, null)
}

function writeLock(id: number, token: string): void {
  setKv(`${LOCK_PREFIX}${id}`, { token, at: Date.now() })
}

function clearLock(id: number): void {
  setKv(`${LOCK_PREFIX}${id}`, null)
}

/**
 * 尝试占用成果的编辑权：两个页面并发提交时只有一个拿到锁。
 * 锁带 TTL，异常退出不会永久占用；token 校验防止误释放别人的锁。
 */
export function acquireLock(id: number, token: string): ActionResult {
  const lock = readLock(id)
  if (lock && Date.now() - lock.at < LOCK_TTL_MS && lock.token !== token) {
    return { ok: false, message: '另一个页面正在提交该成果，本次提交未保留（只保留先提交的版本）' }
  }
  writeLock(id, token)
  return { ok: true, message: '' }
}

export function releaseLock(id: number, token: string): void {
  const lock = readLock(id)
  if (!lock || lock.token === token) {
    clearLock(id)
  }
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export type CompilationActionInput = {
  id: number
  action: CompilationAction
  expectedVersion: number
  token: string
  operator: string
}

export type CompilationActionResult = ActionResult & { version?: number }

/**
 * 执行整编动作：
 * - 状态机校验：只允许从 COMPILATION_FLOW 规定的源状态流转；
 * - 版本校验：期望版本与行版本不一致说明别的页面先提交了，本次不保留；
 * - 驳回清空中间态：审核人、提交时刻一并清掉；
 * - 成功后行版本 +1，供下一次提交做乐观锁基线。
 */
export async function submitCompilationAction(
  input: CompilationActionInput,
): Promise<CompilationActionResult> {
  // 留出极短窗口，让并发的另一次提交先落库，模拟两个页面同时点提交。
  await new Promise((resolve) => window.setTimeout(resolve, 250))
  const locked = acquireLock(input.id, input.token)
  if (!locked.ok) {
    return locked
  }
  try {
    const flow = COMPILATION_FLOW[input.action]
    const rows = readCompilationRows()
    const index = rows.findIndex((row) => Number(row.id) === input.id)
    if (index < 0) {
      return { ok: false, message: '没有找到该整编成果' }
    }
    const row = rows[index]
    if (row.version !== input.expectedVersion) {
      return {
        ok: false,
        message: `该成果已被另一页面更新到版本 ${row.version}，请刷新后再操作；本次提交未保留，只保留一个版本`,
      }
    }
    const currentStatus = String(row.status)
    if (!(flow.from as readonly string[]).includes(currentStatus)) {
      return {
        ok: false,
        message: `成果当前为「${currentStatus}」，不能执行「${input.action}」`,
      }
    }

    const nextRow: CompilationRow = {
      ...row,
      status: flow.to,
      abnormal: input.action === '驳回整编',
      pending: flow.to !== '已刊印',
      version: row.version + 1,
      整编状态: flow.to,
    }
    if (input.action === '提交审核') {
      nextRow.提交时刻 = nowText()
    }
    if (input.action === '审核刊印') {
      nextRow.审核人 = input.operator
    }
    if (input.action === '驳回整编') {
      // 驳回清空中间态：回到已驳回，审核痕迹与提交时刻都不留。
      nextRow.审核人 = ''
      nextRow.提交时刻 = undefined
    }
    if (input.action === '开始整编' && !nextRow.整编人) {
      nextRow.整编人 = input.operator
    }

    const next = [...rows]
    next[index] = nextRow
    writeCompilationRows(next)
    return {
      ok: true,
      version: nextRow.version,
      message: `已${input.action}，当前状态「${flow.to}」，版本 ${nextRow.version}`,
    }
  } finally {
    releaseLock(input.id, input.token)
  }
}

/** 从数据层重新读取一条成果的最新版本号。 */
export function rowVersion(id: number): number | undefined {
  return readCompilationRows().find((row) => Number(row.id) === id)?.version
}
