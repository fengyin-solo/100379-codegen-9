import { MODULE_BY_KEY } from '@/data/modules'
import {
  DEFAULT_CALIBER,
  allRows,
  listRows,
  loadCaliber,
  loadReviews,
  refreshRows,
  resetRows,
  saveCaliber,
  saveReviews,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  ArchiveSnapshot,
  CompilationBoard,
  CompilationBoardCell,
  CompilationCaliber,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReviewItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 数据整编的流转约束：key 是动作，value 是允许执行的当前状态。其它模块不约束来源状态。
const COMPILATION_FLOW: Record<string, string[]> = {
  开始整编: ['待整编', '已驳回'],
  提交审核: ['整编中'],
  确认刊印: ['待审核'],
  归档成果: ['已刊印'],
  驳回整编: ['整编中', '待审核'],
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function rowVersion(row: EntryRow): number {
  return Number(row.version ?? 1)
}

// 整编动作允许的来源状态，页面用它决定每行展示哪些按钮。
export function compilationActionsFor(status: string): string[] {
  return Object.entries(COMPILATION_FLOW)
    .filter(([, sources]) => sources.includes(status))
    .map(([action]) => action)
}

// 驳回整编：清空整编人、审核人这些流程中间态，回到干净的重做起点。
function clearCompilationIntermediate(updated: EntryRow): void {
  updated['整编人'] = ''
  updated['审核人'] = ''
}

// 归档成果：把当前口径与关键结果存成快照，之后口径再调也不影响这条。
function writeArchiveSnapshot(updated: EntryRow): ArchiveSnapshot {
  const caliber = loadCaliber()
  const snapshot: ArchiveSnapshot = {
    caliberVersion: caliber.version,
    fallbackType: caliber.fallbackType,
    effectiveType: String(updated['归类类型'] || updated['整编类型'] || caliber.fallbackType),
    rawCount: Number(updated['原始记录数']) || 0,
    archivedAt: new Date().toISOString().slice(0, 10),
  }
  updated['归档快照'] = JSON.stringify(snapshot)
  updated['口径版本'] = caliber.version
  return snapshot
}

// 巡检等别的入口报告故障时，给数据整编生成一条复核事项。
function appendReview(item: Pick<ReviewItem, 'source' | 'sourceRef' | 'station' | 'detail'>): void {
  const items = loadReviews()
  const id = items.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
  items.unshift({
    ...item,
    id,
    status: '待复核',
    createdAt: new Date().toISOString().slice(0, 10),
  })
  saveReviews(items)
}

export function runAction(
  key: string,
  id: number,
  action: string,
  expectedVersion?: number,
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 先合入其它页面/标签页的提交，再校验版本，保证并发提交只留一个版本。
  refreshRows()
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (expectedVersion !== undefined && rowVersion(rows[index]) !== expectedVersion) {
    return {
      ok: false,
      message: `这条${meta.entity}已在别处提交为新版本，本次操作未生效，请刷新后重试`,
    }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === 'compilation') {
    const sources = COMPILATION_FLOW[action]
    if (sources && !sources.includes(current)) {
      return { ok: false, message: `「${action}」不适用于当前状态「${current}」的整编成果` }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    version: rowVersion(rows[index]) + 1,
  }
  let extraMessage = ''
  if (key === 'compilation' && action === '驳回整编') {
    clearCompilationIntermediate(updated)
    extraMessage = '，整编人、审核人等中间态已清空'
  }
  if (key === 'compilation' && action === '归档成果') {
    const snapshot = writeArchiveSnapshot(updated)
    extraMessage = `，已按口径 v${snapshot.caliberVersion} 留存归档快照`
  }
  if (key === 'inspection' && action === '报告故障') {
    appendReview({
      source: '巡检记录',
      sourceRef: String(updated['记录编号'] ?? ''),
      station: String(updated['站点编号'] ?? ''),
      detail: `巡检报告故障（${updated['发现问题'] || '未填写问题'}），请复核该站点相关年度的整编成果`,
    })
    extraMessage = '，已同步生成数据整编复核事项'
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${extraMessage}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function getCompilationCaliber(): CompilationCaliber {
  return loadCaliber()
}

// 调整汇总口径：口径版本加一，并重算所有未归档成果；已归档成果留在归档时的快照上。
export function updateCompilationCaliber(input: {
  pendingScope: CompilationCaliber['pendingScope']
  includeRejectedRaw: boolean
  fallbackType: string
}): { caliber: CompilationCaliber; recalculated: number } {
  refreshRows()
  const current = loadCaliber()
  const caliber: CompilationCaliber = {
    version: current.version + 1,
    pendingScope: input.pendingScope,
    includeRejectedRaw: input.includeRejectedRaw,
    fallbackType: input.fallbackType.trim() || DEFAULT_CALIBER.fallbackType,
  }
  saveCaliber(caliber)
  const rows = listRows('compilation')
  let recalculated = 0
  const next = rows.map((row) => {
    if (String(row.status) === '已归档') {
      return row
    }
    recalculated += 1
    return {
      ...row,
      归类类型: String(row['整编类型'] ?? '') || caliber.fallbackType,
      口径版本: caliber.version,
      version: rowVersion(row) + 1,
    }
  })
  saveRows('compilation', next)
  return { caliber, recalculated }
}

function parseSnapshot(raw: unknown): ArchiveSnapshot | null {
  if (typeof raw !== 'string' || raw === '') {
    return null
  }
  try {
    return JSON.parse(raw) as ArchiveSnapshot
  } catch {
    return null
  }
}

// 年度成果看板：按整编年份 × 站点聚合，未归档成果按当前口径算，已归档成果用归档快照。
export function compilationBoard(): CompilationBoard {
  const caliber = loadCaliber()
  const cellMap = new Map<string, CompilationBoardCell>()
  for (const row of listRows('compilation')) {
    const year = String(row['整编年份'] ?? '')
    const station = String(row['站点编号'] ?? '')
    if (!year || !station) {
      continue
    }
    const cellKey = `${year}::${station}`
    const cell = cellMap.get(cellKey) ?? { year, station, raw: 0, pending: 0, published: 0, total: 0 }
    const status = String(row.status)
    if (status === '已归档') {
      const snapshot = parseSnapshot(row['归档快照'])
      cell.raw += snapshot?.rawCount ?? (Number(row['原始记录数']) || 0)
      cell.published += 1
    } else {
      if (status !== '已驳回' || caliber.includeRejectedRaw) {
        cell.raw += Number(row['原始记录数']) || 0
      }
      if (status === '待审核' || (caliber.pendingScope === 'includeCompiling' && status === '整编中')) {
        cell.pending += 1
      }
      if (status === '已刊印') {
        cell.published += 1
      }
    }
    cell.total += 1
    cellMap.set(cellKey, cell)
  }
  const cells = [...cellMap.values()]
  const years = [...new Set(cells.map((cell) => cell.year))].sort((a, b) => b.localeCompare(a))
  const stations = [...new Set(cells.map((cell) => cell.station))].sort((a, b) => a.localeCompare(b))
  return { years, stations, cells, caliber }
}

// 看板格子下钻：某一年的某个站点下的全部整编成果。
export function compilationCellEntries(year: string, station: string): EntryRow[] {
  return listRows('compilation').filter(
    (row) => String(row['整编年份'] ?? '') === year && String(row['站点编号'] ?? '') === station,
  )
}

export function listReviewItems(): ReviewItem[] {
  return loadReviews()
}

export function completeReviewItem(id: number): ActionResult {
  const items = loadReviews()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的复核事项` }
  }
  if (items[index].status === '已复核') {
    return { ok: false, message: '这条复核事项已经复核过了' }
  }
  items[index] = { ...items[index], status: '已复核' }
  saveReviews(items)
  return { ok: true, message: '复核事项已完成复核' }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
