/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 数据整编的汇总口径：看板与重算都以它为准，调整一次版本号加一。 */
export type CompilationCaliber = {
  version: number
  /** 待审核成果的统计范围：仅待审核，或把整编中也算进去 */
  pendingScope: 'pendingOnly' | 'includeCompiling'
  /** 原始记录数是否计入已驳回成果 */
  includeRejectedRaw: boolean
  /** 旧年度缺整编类型时的归类 */
  fallbackType: string
}

/** 归档时留存的快照：之后口径怎么调，归档成果都按这份算。 */
export type ArchiveSnapshot = {
  caliberVersion: number
  fallbackType: string
  effectiveType: string
  rawCount: number
  archivedAt: string
}

export type CompilationBoardCell = {
  year: string
  station: string
  raw: number
  pending: number
  published: number
  total: number
}

export type CompilationBoard = {
  years: string[]
  stations: string[]
  cells: CompilationBoardCell[]
  caliber: CompilationCaliber
}

/** 复核事项：由巡检等其他入口报告故障时自动生成，在数据整编里闭环。 */
export type ReviewItem = {
  id: number
  source: string
  sourceRef: string
  station: string
  detail: string
  status: string
  createdAt: string
}
