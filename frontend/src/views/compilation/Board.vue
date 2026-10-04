<template>
  <div class="board-wrap">
    <div class="board-toolbar">
      <div class="caliber-switch">
        <span class="caliber-label">汇总口径：</span>
        <button
          v-for="item in calibers"
          :key="item.version"
          type="button"
          class="caliber-btn"
          :class="{ active: board.caliber.version === item.version }"
          @click="switchCaliber(item.version)"
        >
          {{ item.label }}
        </button>
        <span class="caliber-desc">{{ board.caliber.desc }}</span>
      </div>
      <button class="btn ghost" type="button" @click="refresh">重算未归档成果</button>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">原始记录数合计</span>
        <strong class="stat-value">{{ board.totals.raw.toLocaleString() }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待审核成果（{{ board.caliber.label }}）</span>
        <strong class="stat-value">{{ board.totals.pending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已刊印成果</span>
        <strong class="stat-value">{{ board.totals.published }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">归档格子</span>
        <strong class="stat-value">{{ archivedCellCount }}</strong>
      </article>
    </div>

    <div class="board-scroll">
      <table class="board-table">
        <thead>
          <tr>
            <th class="year-head">整编年份</th>
            <th v-for="station in board.stations" :key="station.code">
              <div class="station-code">{{ station.code }}</div>
              <div class="station-name">{{ station.name }}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="year in board.years" :key="year">
            <th class="year-cell">{{ year }}</th>
            <td v-for="station in board.stations" :key="station.code">
              <button
                v-if="cell(year, station.code)"
                type="button"
                class="board-cell"
                :class="{ archived: !!cell(year, station.code)?.archive, reviewOnly: cell(year, station.code)?.reviewOnly }"
                @click="emit('drill', { year, station: station.code })"
              >
                <span class="cell-badges">
                  <em v-if="cell(year, station.code)?.archive" class="badge archive-badge">
                    已归档·{{ cell(year, station.code)?.archive?.caliber === 'v1-2023' ? '2023口径' : '2026口径' }}
                  </em>
                  <em
                    v-if="cell(year, station.code)?.openReviews"
                    class="badge review-badge"
                    :title="`该格有 ${cell(year, station.code)?.openReviews} 条未关闭复核事项`"
                  >
                    复核 {{ cell(year, station.code)?.openReviews }}
                  </em>
                  <em
                    v-if="cell(year, station.code)?.reviewOnly"
                    class="badge reviewonly-badge"
                  >
                    仅复核事项
                  </em>
                </span>
                <span class="cell-metrics">
                  <span class="metric raw" @click.stop="emit('drill', { year, station: station.code, metric: 'raw' })">
                    <b>{{ cell(year, station.code)?.raw.toLocaleString() }}</b>
                    <i>原始记录</i>
                  </span>
                  <span
                    class="metric pending"
                    :class="{ zero: !cell(year, station.code)?.pending }"
                    @click.stop="emit('drill', { year, station: station.code, metric: 'pending' })"
                  >
                    <b>{{ cell(year, station.code)?.pending }}</b>
                    <i>待审核</i>
                  </span>
                  <span
                    class="metric published"
                    :class="{ zero: !cell(year, station.code)?.published }"
                    @click.stop="emit('drill', { year, station: station.code, metric: 'published' })"
                  >
                    <b>{{ cell(year, station.code)?.published }}</b>
                    <i>已刊印</i>
                  </span>
                </span>
              </button>
              <span v-else class="cell-empty">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot board-foot">
      <span>
        点击格子下钻成果清单；点击单项指标可只看对应口径下的记录。
        旧年度（{{ legacyYear }} 年以前）缺整编类型的成果统一归为「年度成果（历史补录）」，共
        {{ board.legacyCount }} 条。
      </span>
      <span v-if="staleArchiveCount" class="warn-text">
        有 {{ staleArchiveCount }} 个归档快照沿用旧口径，切换口径不重算；需要最新口径请先取消归档。
      </span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { caliberList, changeCaliber, loadBoard, type BoardResult } from '@/api/compilation-service'
import { LEGACY_YEAR, type BoardMetric, type CaliberVersion } from '@/data/compilation'
import { bindStorageSync } from '@/data/local-store'

const emit = defineEmits<{
  (event: 'drill', payload: { year: string; station: string; metric?: BoardMetric }): void
}>()

const calibers = caliberList()
const legacyYear = LEGACY_YEAR
const board = ref<BoardResult>(loadBoard())

const archivedCellCount = computed(
  () => [...board.value.cells.values()].filter((item) => item.archive).length,
)
const staleArchiveCount = computed(() =>
  [...board.value.cells.values()].filter(
    (item) => item.archive && item.archive.caliber !== board.value.caliber.version,
  ).length,
)

function cell(year: string, station: string) {
  return board.value.cells.get(`${year}__${station}`)
}

function switchCaliber(version: CaliberVersion) {
  if (version === board.value.caliber.version) {
    return
  }
  changeCaliber(version)
  refresh()
}

function refresh() {
  board.value = loadBoard()
}

defineExpose({ refresh })

onMounted(() => {
  bindStorageSync(refresh)
})
</script>
