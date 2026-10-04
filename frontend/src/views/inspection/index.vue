<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">
          维护巡检记录，围绕记录编号、站点编号、巡检日期、巡检人员做登记、筛选与状态流转；
          巡检发现的整编问题可直接生成复核事项，进入数据整编年度成果看板对应年份站点格子。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

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
      <span class="legend-item review-legend">已生成整编复核事项：{{ openReviewCount }} 条未关闭</span>
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
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无巡检记录数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="infoMessage" class="ok-text">{{ infoMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { createReviewFromInspection, listReviews } from '@/api/compilation-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { bindStorageSync } from '@/data/local-store'

const session = useSessionStore()
const meta = moduleMeta('inspection')
const columns = ['记录编号', '站点编号', '巡检日期', '巡检人员', '检查项目', '发现问题', '处理措施', '巡检状态']
const actions = ['完成巡检', '报告故障', '确认处置', '生成复核事项']
const statuses = ['待巡检', '已巡检', '发现故障', '已处置']
const stats = [{ label: '本月巡检次数', value: 0 }, { label: '已巡检站点', value: 0 }, { label: '待处置故障', value: 0 }]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const openReviewCount = ref(listReviews(true).length)
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  if (action === '生成复核事项') {
    const review = createReviewFromInspection({
      sourceId: Number(row.id),
      sourceCode: String(row.记录编号 ?? `INSP-${row.id}`),
      station: String(row.站点编号 ?? ''),
      content: `巡检「${String(row.检查项目 ?? '现场检查')}」发现：${String(
        row.发现问题 ?? '需复核整编数据',
      )}`,
      operator: session.operator,
    })
    openReviewCount.value = listReviews(true).length
    infoMessage.value = `已为 ${review.year} 年·${review.station} 生成整编复核事项，请到数据整编年度成果看板处理`
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    openReviewCount.value = listReviews(true).length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

onMounted(() => {
  reload()
  bindStorageSync(reload)
})
</script>
