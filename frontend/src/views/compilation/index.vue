<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">
          维护整编成果，围绕成果编号、整编年份、站点编号、整编类型做登记、筛选与状态流转；
          年度成果看板按年份×站点汇总原始记录数、待审核成果与已刊印成果。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
      </div>
    </header>

    <div class="view-tabs" role="tablist">
      <button
        type="button"
        class="view-tab"
        :class="{ active: view === 'board' }"
        role="tab"
        @click="view = 'board'"
      >
        年度成果看板
      </button>
      <button
        type="button"
        class="view-tab"
        :class="{ active: view === 'list' }"
        role="tab"
        @click="view = 'list'"
      >
        成果清单
      </button>
    </div>

    <CompilationBoard ref="boardRef" v-if="view === 'board'" @drill="openDrill" />

    <template v-else>
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

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
            <th>版本</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ displayValue(row, column) }}</td>
            <td>
              <span class="version-tag">v{{ row.version ?? 1 }}</span>
              <span v-if="row.提交时刻" class="submit-time" :title="`提交时刻 ${row.提交时刻}`">⏱</span>
            </td>
            <td>
              {{ row.status }}
              <span v-if="row.status === '已驳回'" class="reject-flag" title="驳回后中间态已清空">中间态已清空</span>
            </td>
            <td class="row-actions">
              <button
                v-for="action in availableActions(row)"
                :key="action"
                class="link"
                type="button"
                :disabled="busyId === row.id"
                @click="runAction(action, row)"
              >
                {{ busyId === row.id ? '提交中…' : action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无数据整编数据</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条数据整编记录 · 并发提交采用版本号乐观锁，两个页面同时提交只保留先成功的一个版本</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <CompilationDrill
      v-if="drill"
      :year="drill.year"
      :station="drill.station"
      :metric="drill.metric"
      @close="drill = null"
      @changed="onDrillChanged"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  submitCompilationAction,
} from '@/api/compilation-service'
import {
  COMPILATION_FLOW,
  resolveCompilationType,
  type BoardMetric,
  type CompilationAction,
  type CompilationRow,
} from '@/data/compilation'
import { bindStorageSync } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import CompilationBoard from './Board.vue'
import CompilationDrill from './Drill.vue'

const session = useSessionStore()
const meta = moduleMeta('compilation')
const columns = ['成果编号', '整编年份', '站点编号', '整编类型', '原始记录数', '整编人', '审核人', '整编状态']
const statuses = ['待整编', '整编中', '待审核', '已刊印', '已驳回']

const view = ref<'board' | 'list'>('board')
const rows = ref<CompilationRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const busyId = ref<number | null>(null)
const drill = ref<{ year: string; station: string; metric?: BoardMetric } | null>(null)
const boardRef = ref<InstanceType<typeof CompilationBoard> | null>(null)

const stats = computed(() => [
  { label: '登记成果总数', value: rows.value.length },
  {
    label: '待审核成果',
    value: rows.value.filter((row) => ['整编中', '待审核', '已驳回'].includes(String(row.status))).length,
  },
  { label: '已刊印成果', value: rows.value.filter((row) => String(row.status) === '已刊印').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function displayValue(row: EntryRow, column: string): string {
  if (column === '整编类型') {
    return resolveCompilationType(row)
  }
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function availableActions(row: CompilationRow): CompilationAction[] {
  return (Object.keys(COMPILATION_FLOW) as CompilationAction[]).filter((action) =>
    (COMPILATION_FLOW[action].from as readonly string[]).includes(String(row.status)),
  )
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

async function runAction(action: CompilationAction, row: CompilationRow) {
  errorMessage.value = ''
  busyId.value = Number(row.id)
  try {
    const result = await submitCompilationAction({
      id: Number(row.id),
      action,
      expectedVersion: row.version ?? 1,
      token: `list-${row.id}-${Date.now()}`,
      operator: session.operator,
    })
    if (!result.ok) {
      errorMessage.value = result.message
    }
    reload()
  } finally {
    busyId.value = null
  }
}

function openDrill(payload: { year: string; station: string; metric?: BoardMetric }) {
  drill.value = payload
}

function onDrillChanged() {
  // 抽屉里的流转/归档/复核发生在同一标签页，storage 事件不会回调本页，需要主动刷新看板与清单。
  boardRef.value?.refresh()
  if (view.value === 'list') {
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items as CompilationRow[]
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

onMounted(() => {
  reload()
  // 别的标签页提交了成果/生成了复核事项时，本页数据已被 storage 事件标记失效，回到本页自动重取。
  bindStorageSync(() => {
    boardRef.value?.refresh()
    if (view.value === 'list') {
      reload()
    }
  })
})
</script>
