<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">
          维护整编成果，围绕成果编号、整编年份、站点编号、整编类型做登记、筛选与状态流转；年度成果看板按年份和站点汇总原始记录数、待审核成果与已刊印成果。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
      </div>
    </header>

    <nav class="view-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="btn"
        :class="{ primary: view === tab.key }"
        type="button"
        @click="switchView(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <template v-if="view === 'board'">
      <div class="caliber-bar">
        <span>{{ caliberSummary }}</span>
        <button class="btn" type="button" @click="toggleCaliberForm">调整汇总口径</button>
      </div>

      <form v-if="caliberEditing" class="filter-bar" @submit.prevent="saveCaliber">
        <label class="filter-item">
          <span>待审核成果口径</span>
          <select v-model="caliberForm.pendingScope">
            <option value="pendingOnly">仅统计待审核</option>
            <option value="includeCompiling">待审核＋整编中</option>
          </select>
        </label>
        <label class="filter-item">
          <span>原始记录数口径</span>
          <select v-model="caliberForm.includeRejectedRaw">
            <option :value="true">计入已驳回成果</option>
            <option :value="false">不计入已驳回成果</option>
          </select>
        </label>
        <label class="filter-item">
          <span>缺整编类型归类</span>
          <input v-model="caliberForm.fallbackType" placeholder="综合整编" />
        </label>
        <button class="btn primary" type="submit">保存口径并重算未归档成果</button>
        <button class="btn ghost" type="button" @click="caliberEditing = false">取消</button>
      </form>
      <p v-if="recalcMessage" class="recalc-text">{{ recalcMessage }}</p>

      <table class="data-table board-table">
        <thead>
          <tr>
            <th>整编年份＼站点</th>
            <th v-for="station in board.stations" :key="station">{{ station }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="year in board.years" :key="year">
            <td class="board-year">{{ year }}</td>
            <td v-for="station in board.stations" :key="station">
              <button
                v-if="cellOf(year, station)"
                class="board-cell"
                type="button"
                @click="drill(year, station)"
              >
                <span>原始记录 {{ cellOf(year, station)?.raw }}</span>
                <span>待审核 {{ cellOf(year, station)?.pending }}</span>
                <span>已刊印 {{ cellOf(year, station)?.published }}</span>
              </button>
              <span v-else class="board-empty">—</span>
            </td>
          </tr>
          <tr v-if="!board.years.length">
            <td :colspan="board.stations.length + 1" class="empty-state">暂无整编成果，看板没有可汇总的数据</td>
          </tr>
        </tbody>
      </table>
      <p class="board-note">
        已刊印成果含已归档；已归档成果按归档时的口径快照计入，调整当前口径不影响它们。点击格子可下钻该年份该站点的成果清单。
      </p>

      <section v-if="drillDown" class="drill-panel">
        <header class="drill-head">
          <h3>{{ drillDown.year }} 年 · {{ drillDown.station }} 整编成果清单</h3>
          <button class="btn ghost" type="button" @click="drillDown = null">收起</button>
        </header>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in drillColumns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in drillDown.rows" :key="String(row.id)">
              <td v-for="column in drillColumns" :key="column">{{ row[column] ?? '—' }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <button
                  v-for="action in actionsFor(row)"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runAction(action, row)"
                >
                  {{ action }}
                </button>
                <span v-if="!actionsFor(row).length">—</span>
              </td>
            </tr>
            <tr v-if="!drillDown.rows.length">
              <td :colspan="drillColumns.length + 2" class="empty-state">该格子下暂无整编成果</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <template v-else-if="view === 'list'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="!actionsFor(row).length">—</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无数据整编数据</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <p class="page-desc review-desc">
        巡检记录等别的入口报告故障后会自动生成复核事项，在这里逐项复核闭环。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>来源</th>
            <th>来源单号</th>
            <th>站点编号</th>
            <th>事项说明</th>
            <th>生成日期</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviews" :key="item.id">
            <td>{{ item.id }}</td>
            <td>{{ item.source }}</td>
            <td>{{ item.sourceRef }}</td>
            <td>{{ item.station }}</td>
            <td>{{ item.detail }}</td>
            <td>{{ item.createdAt }}</td>
            <td>{{ item.status }}</td>
            <td>
              <button
                v-if="item.status === '待复核'"
                class="link"
                type="button"
                @click="completeReview(item.id)"
              >
                完成复核
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!reviews.length">
            <td colspan="8" class="empty-state">暂无复核事项，巡检记录报告故障后会自动生成</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>共 {{ total }} 条数据整编记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  compilationActionsFor,
  compilationBoard,
  compilationCellEntries,
  completeReviewItem,
  downloadEntries,
  listEntries,
  listReviewItems,
  moduleMeta,
  runAction as applyAction,
  updateCompilationCaliber,
} from '@/api/local-service'
import type { CompilationBoard, CompilationCaliber, EntryRow, ReviewItem } from '@/data/types'

const meta = moduleMeta('compilation')
const columns = [...meta.fields.slice(0, 4), '归类类型', ...meta.fields.slice(4), '口径版本']
const drillColumns = ['成果编号', '整编类型', '归类类型', '原始记录数', '整编人', '审核人']
const statuses = meta.statuses
const filterFields = meta.fields.slice(0, 3)

// 看板首次渲染前的占位口径，onMounted 的 reload 会换成真实口径
const INITIAL_CALIBER: CompilationCaliber = {
  version: 1,
  pendingScope: 'pendingOnly',
  includeRejectedRaw: true,
  fallbackType: '综合整编',
}

type ViewKey = 'board' | 'list' | 'reviews'

const view = ref<ViewKey>('board')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const board = ref<CompilationBoard>({ years: [], stations: [], cells: [], caliber: INITIAL_CALIBER })
const reviews = ref<ReviewItem[]>([])
const filters = ref<Record<string, string>>({})
const errorMessage = ref('')
const noticeMessage = ref('')
const recalcMessage = ref('')
const caliberEditing = ref(false)
const caliberForm = ref({ pendingScope: 'pendingOnly' as CompilationCaliber['pendingScope'], includeRejectedRaw: true, fallbackType: '综合整编' })
const drillDown = ref<{ year: string; station: string; rows: EntryRow[] } | null>(null)

const tabs = computed(() => [
  { key: 'board' as ViewKey, label: '年度成果看板' },
  { key: 'list' as ViewKey, label: '成果清单' },
  { key: 'reviews' as ViewKey, label: `复核事项（${pendingReviewCount.value}）` },
])

const pendingReviewCount = computed(
  () => reviews.value.filter((item) => item.status === '待复核').length,
)

const stats = computed(() => [
  { label: '待审核成果（当前口径）', value: board.value.cells.reduce((sum, cell) => sum + cell.pending, 0) },
  { label: '已刊印成果（含已归档）', value: board.value.cells.reduce((sum, cell) => sum + cell.published, 0) },
  { label: '待复核事项', value: pendingReviewCount.value },
  { label: '汇总口径版本', value: `v${board.value.caliber.version}` },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const caliberSummary = computed(() => {
  const caliber = board.value.caliber
  const pending = caliber.pendingScope === 'includeCompiling' ? '待审核＋整编中' : '仅待审核'
  const raw = caliber.includeRejectedRaw ? '计入已驳回成果' : '不计入已驳回成果'
  return `当前汇总口径 v${caliber.version}：待审核成果＝${pending}；原始记录数${raw}；缺整编类型归入「${caliber.fallbackType}」`
})

const cellMap = computed(() => {
  const map = new Map<string, (typeof board.value.cells)[number]>()
  for (const cell of board.value.cells) {
    map.set(`${cell.year}::${cell.station}`, cell)
  }
  return map
})

function cellOf(year: string, station: string) {
  return cellMap.value.get(`${year}::${station}`)
}

function actionsFor(row: EntryRow): string[] {
  return compilationActionsFor(String(row.status))
}

function switchView(next: ViewKey) {
  view.value = next
  reload()
}

function toggleCaliberForm() {
  const caliber = board.value.caliber
  caliberForm.value = {
    pendingScope: caliber.pendingScope,
    includeRejectedRaw: caliber.includeRejectedRaw,
    fallbackType: caliber.fallbackType,
  }
  caliberEditing.value = !caliberEditing.value
}

function saveCaliber() {
  errorMessage.value = ''
  const result = updateCompilationCaliber({ ...caliberForm.value })
  caliberEditing.value = false
  recalcMessage.value = `口径已更新为 v${result.caliber.version}，重算了 ${result.recalculated} 条未归档成果；已归档成果沿用归档时的口径快照。`
  reload()
}

function drill(year: string, station: string) {
  drillDown.value = { year, station, rows: compilationCellEntries(year, station) }
}

function runAction(action: string, row: EntryRow) {
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, Number(row.version ?? 1))
  // 并发提交只留一个版本：无论成败都刷新到最新数据，再展示本次结果
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
}

function completeReview(id: number) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = completeReviewItem(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    board.value = compilationBoard()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reviews.value = listReviewItems()
    if (drillDown.value) {
      drillDown.value = {
        ...drillDown.value,
        rows: compilationCellEntries(drillDown.value.year, drillDown.value.station),
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

onMounted(reload)
</script>
