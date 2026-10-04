<template>
  <div class="drawer-mask" @click.self="emit('close')">
    <aside class="drawer">
      <header class="drawer-head">
        <div>
          <h3>{{ data.year }} 年 · {{ stationName(data.station) }}（{{ data.station }}）成果清单</h3>
          <p class="page-desc">
            当前口径：{{ data.caliber.label }}
            <template v-if="metricLabel">· 下钻指标：{{ metricLabel }}</template>
          </p>
        </div>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <section v-if="data.archive" class="archive-banner">
        <div>
          <strong>归档快照</strong>
          <span>
            {{ data.archive.archivedAt }} 由 {{ data.archive.operator }} 按「{{
              data.archive.caliber === 'v1-2023' ? '2023 原口径' : '2026 调整口径'
            }}」归档，原始记录 {{ data.archive.raw.toLocaleString() }} / 待审核 {{ data.archive.pending }}
            / 已刊印 {{ data.archive.published }}
          </span>
          <em v-if="data.archive.caliber !== data.caliber.version" class="warn-text">
            快照沿用归档当时口径，当前已切换口径也不会重算本格
          </em>
        </div>
        <button class="btn" type="button" @click="doUnarchive">取消归档（恢复实时重算）</button>
      </section>

      <section v-else class="archive-bar">
        <span class="caliber-desc">未归档：指标随汇总口径调整实时重算。</span>
        <button class="btn primary" type="button" :disabled="!data.rows.length" @click="doArchive">
          按当前口径归档（冻结快照）
        </button>
      </section>

      <section v-if="data.reviews.length" class="review-box">
        <h4>巡检入口生成的复核事项（{{ data.reviews.length }}）</h4>
        <ul>
          <li v-for="item in data.reviews" :key="item.id">
            <div>
              <strong>{{ item.sourceCode }}</strong>
              <span>{{ item.content }}</span>
              <small>{{ item.createdAt }} · {{ item.operator }}</small>
            </div>
            <button class="link" type="button" @click="doCloseReview(item.id)">复核完成</button>
          </li>
        </ul>
      </section>

      <table class="data-table drill-table">
        <thead>
          <tr>
            <th>成果编号</th>
            <th>整编类型</th>
            <th>原始记录数</th>
            <th>整编人</th>
            <th>审核人</th>
            <th>提交时刻</th>
            <th>版本</th>
            <th>状态</th>
            <th>动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data.rows" :key="row.id">
            <td>{{ row.成果编号 }}</td>
            <td>
              {{ row.整编类型 }}
              <em v-if="isLegacyType(row)" class="legacy-flag">历史补录归类</em>
            </td>
            <td>{{ row.原始记录数.toLocaleString() }}</td>
            <td>{{ row.整编人 || '—' }}</td>
            <td>{{ row.审核人 || '—' }}</td>
            <td>{{ row.提交时刻 || '—' }}</td>
            <td><span class="version-tag">v{{ row.version }}</span></td>
            <td>{{ row.status }}</td>
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
          <tr v-if="!data.rows.length">
            <td colspan="9" class="empty-state">
              {{ metricLabel ? `当前口径下没有「${metricLabel}」对应的成果` : '该格子暂无整编成果' }}
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot drawer-foot">
        <span>驳回整编会清空审核人、提交时刻等中间态；两个页面并发提交时只保留版本校验通过的一个版本。</span>
        <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  archiveCell,
  closeReview,
  loadDrill,
  stationName,
  submitCompilationAction,
  unarchiveCell,
  type DrillResult,
} from '@/api/compilation-service'
import {
  COMPILATION_FLOW,
  isLegacyType,
  type BoardMetric,
  type CompilationAction,
  type CompilationRow,
} from '@/data/compilation'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ year: string; station: string; metric?: BoardMetric }>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'changed'): void }>()

const session = useSessionStore()
const data = ref<DrillResult>(loadDrill(props.year, props.station, { metric: props.metric }))
const busyId = ref<number | null>(null)
const message = ref('')
const messageOk = ref(false)

const metricLabel = computed(() => {
  if (props.metric === 'raw') {
    return '原始记录'
  }
  if (props.metric === 'pending') {
    return '待审核成果'
  }
  if (props.metric === 'published') {
    return '已刊印成果'
  }
  return ''
})

function availableActions(row: CompilationRow): CompilationAction[] {
  return (Object.keys(COMPILATION_FLOW) as CompilationAction[]).filter((action) =>
    (COMPILATION_FLOW[action].from as readonly string[]).includes(String(row.status)),
  )
}

function reload() {
  data.value = loadDrill(props.year, props.station, { metric: props.metric })
}

async function runAction(action: CompilationAction, row: CompilationRow) {
  message.value = ''
  busyId.value = Number(row.id)
  try {
    const result = await submitCompilationAction({
      id: Number(row.id),
      action,
      expectedVersion: row.version,
      token: `drill-${row.id}-${Date.now()}`,
      operator: session.operator,
    })
    message.value = result.message
    messageOk.value = result.ok
    // 无论成功失败都重取：成功拿新状态新版本，失败（如别的页面抢先提交）也同步到最新版本。
    reload()
    emit('changed')
  } finally {
    busyId.value = null
  }
}

function doArchive() {
  const result = archiveCell(props.year, props.station, session.operator)
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    reload()
    emit('changed')
  }
}

function doUnarchive() {
  const result = unarchiveCell(props.year, props.station)
  message.value = result.message
  messageOk.value = result.ok
  reload()
  emit('changed')
}

function doCloseReview(id: number) {
  const result = closeReview(id)
  message.value = result.message
  messageOk.value = result.ok
  reload()
  emit('changed')
}

watch(
  () => [props.year, props.station, props.metric],
  () => reload(),
)
</script>
