/**
 * 数据整编领域模型：年度成果看板、汇总口径、归档快照、复核事项都集中在这里。
 * 纯函数 + localStorage 读写，不依赖 Vue，方便换后端时整层替换。
 */
import type { EntryRow } from './types'

/** 成果行上跟整编业务相关的结构化字段（其余展示字段仍挂在 EntryRow 上）。 */
export type CompilationRow = EntryRow & {
  成果编号: string
  整编年份: string | number
  站点编号: string
  整编类型: string
  原始记录数: number
  整编人: string
  审核人: string
  /** 乐观锁版本号：每次成功流转 +1，提交时携带期望版本做并发校验。 */
  version: number
  /** 提交审核时刻；驳回时随中间态一并清空。 */
  提交时刻?: string
}

/** 汇总口径版本。旧看板数据在两种口径下数字可能不同。 */
export type CaliberVersion = 'v1-2023' | 'v2-2026'

export type CaliberMeta = {
  version: CaliberVersion
  label: string
  desc: string
  /** 该口径下计入「待审核成果」的状态集合。 */
  pendingStatuses: string[]
}

/**
 * v1（2023 口径）：只有「待审核」算待审核成果；
 * v2（2026 调整口径）：整编中、已驳回同样是未归档在途成果，一并计入待审核成果。
 * 已刊印、原始记录数两种口径口径一致。
 */
export const CALIBERS: CaliberMeta[] = [
  {
    version: 'v1-2023',
    label: '2023 原口径',
    desc: '待审核成果仅统计状态为「待审核」的成果。',
    pendingStatuses: ['待审核'],
  },
  {
    version: 'v2-2026',
    label: '2026 调整口径',
    desc: '整编中、待审核、已驳回均属未归档在途成果，计入待审核成果。',
    pendingStatuses: ['整编中', '待审核', '已驳回'],
  },
]

export const CALIBER_BY_VERSION = new Map(CALIBERS.map((item) => [item.version, item]))

/** 整编状态机：动作 → 允许的源状态与目标状态。 */
export const COMPILATION_FLOW = {
  开始整编: { from: ['待整编', '已驳回'], to: '整编中' },
  提交审核: { from: ['整编中'], to: '待审核' },
  驳回整编: { from: ['待审核'], to: '已驳回' },
  审核刊印: { from: ['待审核'], to: '已刊印' },
} as const

export type CompilationAction = keyof typeof COMPILATION_FLOW

/** 旧年度分界：该年之前（不含）登记的成果，整编类型缺失时按历史补录归类。 */
export const LEGACY_YEAR = 2020
export const LEGACY_TYPE = '年度成果（历史补录）'
export const PUBLISHED_STATUS = '已刊印'

/** 年份×站点的看板坐标。 */
export type CellKey = { year: string; station: string }

export function cellKey(key: CellKey): string {
  return `${key.year}__${key.station}`
}

/** 格子下钻时可定位的指标列。 */
export type BoardMetric = 'raw' | 'pending' | 'published'

/** 格子在某种口径下的汇总结果；归档后改用快照里的同构结构。 */
export type CellMetrics = {
  raw: number
  pending: number
  published: number
  caliber: CaliberVersion
}

/** 归档快照：归档那一刻的口径与三项指标冻结在此，后续切口径不重算。 */
export type ArchiveSnapshot = CellMetrics & {
  archivedAt: string
  operator: string
  /** 冗余坐标，便于不依赖归档索引直接渲染。 */
  year: string
  station: string
}

/** 别的巡检入口生成的复核事项。 */
export type ReviewItem = {
  id: number
  module: string
  sourceId: number
  sourceCode: string
  station: string
  year: string
  content: string
  createdAt: string
  operator: string
  open: boolean
}

export type BoardCell = {
  year: string
  station: string
  /** 原始记录数：归该格所有成果原始记录数之和。 */
  raw: number
  /** 待审核成果：按当前口径（归档格按快照口径）统计。 */
  pending: number
  /** 已刊印成果数。 */
  published: number
  /** 该格成果条数。 */
  count: number
  /** 未关闭的复核事项条数。 */
  openReviews: number
  /** 归档后存在，表示展示的是归档当时冻结的指标。 */
  archive?: ArchiveSnapshot
  /** 仅有复核事项、还没有任何成果登记的格子也允许点出清单。 */
  reviewOnly?: boolean
}

function isBlankType(value: unknown): boolean {
  const text = String(value ?? '').trim()
  return text === '' || text.includes('样例')
}

type TypedRow = {
  [field: string]: string | number | boolean | undefined
}

/**
 * 旧年度成果缺整编类型时的归类规则：整编年份早于 2020 且类型缺失/占位，
 * 统一归为「年度成果（历史补录）」。仅做展示与归类归一，不回写原始记录。
 */
export function resolveCompilationType(row: TypedRow): string {
  const rawType = String(row.整编类型 ?? '').trim()
  const year = Number(row.整编年份)
  if (isBlankType(rawType) && Number.isFinite(year) && year < LEGACY_YEAR) {
    return LEGACY_TYPE
  }
  return rawType || '未分类'
}

export function isLegacyType(row: TypedRow): boolean {
  return resolveCompilationType(row) === LEGACY_TYPE
}

export function caliberOf(version: CaliberVersion): CaliberMeta {
  const meta = CALIBER_BY_VERSION.get(version)
  if (!meta) {
    throw new Error(`未知的汇总口径版本：${version}`)
  }
  return meta
}

/** 按指定口径汇总一组成果行。 */
export function summarizeRows(rows: CompilationRow[], caliber: CaliberVersion): CellMetrics {
  const meta = caliberOf(caliber)
  let raw = 0
  let pending = 0
  let published = 0
  for (const row of rows) {
    raw += Number(row.原始记录数) || 0
    const status = String(row.status)
    if (meta.pendingStatuses.includes(status)) {
      pending += 1
    }
    if (status === PUBLISHED_STATUS) {
      published += 1
    }
  }
  return { raw, pending, published, caliber }
}

export function isCompilationRow(row: EntryRow): row is CompilationRow {
  return typeof row.成果编号 === 'string' && typeof row.站点编号 === 'string'
}
