<template>
  <section class="page" data-module="powerledger">
    <header class="page-head">
      <div>
        <h2>厂用电分项能耗台账</h2>
        <p class="page-desc">
          每块电能表挂分项计量名称、所在区域与倍率，月度读数按分项并排展示；
          同表同月只记一条，倍率调整后历史月份仍按当时倍率保留，能耗异常的分项会高亮。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="recalc">重算能耗明细</button>
        <button class="btn" type="button" @click="exportCsv">导出台账</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">分项电能表</span>
        <strong class="stat-value">{{ meters.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">最新月（{{ latestMonth || '—' }}）已抄</span>
        <strong class="stat-value">{{ latestCopied }}/{{ meters.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">能耗异常分项</span>
        <strong class="stat-value abnormal-value">{{ abnormalMeterIds.size }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">停抄记录</span>
        <strong class="stat-value">{{ suspended.length }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="submitReading">
      <label class="filter-item">
        <span>电能表</span>
        <select v-model.number="readForm.meterId">
          <option v-for="meter in meters" :key="meter.id" :value="meter.id">
            {{ meter.code }} · {{ meter.item }}（{{ meter.area }}）
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>抄表月份</span>
        <input v-model="readForm.month" type="month" />
      </label>
      <label class="filter-item">
        <span>本月表码（kWh）</span>
        <input v-model.number="readForm.value" type="number" min="0" step="0.01" :disabled="readForm.suspended" placeholder="停抄时留空" />
      </label>
      <label class="filter-item checkbox-item">
        <span>停抄</span>
        <input v-model="readForm.suspended" type="checkbox" />
      </label>
      <label class="filter-item grow">
        <span>说明（停抄必填，如设备检修）</span>
        <input v-model="readForm.note" placeholder="抄录备注 / 停抄原因" />
      </label>
      <button class="btn primary" type="submit">登记读数</button>
    </form>

    <form class="filter-bar" @submit.prevent="submitRatio">
      <label class="filter-item">
        <span>调整倍率的电能表</span>
        <select v-model.number="ratioForm.meterId">
          <option v-for="meter in meters" :key="meter.id" :value="meter.id">
            {{ meter.code }} · {{ meter.item }}（当前倍率 {{ meter.ratio }}）
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>新倍率</span>
        <input v-model.number="ratioForm.ratio" type="number" min="0.0001" step="0.0001" />
      </label>
      <label class="filter-item">
        <span>生效月份</span>
        <input v-model="ratioForm.month" type="month" />
      </label>
      <button class="btn" type="submit">调整倍率</button>
      <span class="form-hint">倍率只影响之后抄录的读数，历史月份按当时快照保留</span>
    </form>

    <p v-if="message" class="ok-text">{{ message }}</p>
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <h3 class="section-title">分项能耗矩阵（kWh，点击行查看走势）</h3>
    <table class="data-table matrix-table">
      <thead>
        <tr>
          <th>表计编号</th>
          <th>分项计量名称</th>
          <th>所在区域</th>
          <th>当前倍率</th>
          <th v-for="month in months" :key="month">{{ month }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="meter in meters"
          :key="meter.id"
          :class="{ 'row-abnormal': abnormalMeterIds.has(meter.id), 'row-selected': selectedMeterId === meter.id }"
          @click="selectMeter(meter.id)"
        >
          <td>{{ meter.code }}</td>
          <td>
            {{ meter.item }}
            <span v-if="abnormalMeterIds.has(meter.id)" class="tag-abnormal">异常</span>
          </td>
          <td>{{ meter.area }}</td>
          <td>{{ meter.ratio }}</td>
          <td
            v-for="month in months"
            :key="month"
            :class="cellClass(meter.id, month)"
          >
            <template v-if="cellEntry(meter.id, month)">
              <template v-if="cellEntry(meter.id, month)!.status === '停抄'">停抄</template>
              <template v-else-if="cellEntry(meter.id, month)!.energy === null">—</template>
              <template v-else>
                {{ formatEnergy(cellEntry(meter.id, month)!.energy) }}
                <span v-if="cellEntry(meter.id, month)!.mom !== null" class="mom">
                  {{ formatMom(cellEntry(meter.id, month)!.mom) }}
                </span>
              </template>
            </template>
            <template v-else>—</template>
          </td>
        </tr>
        <tr v-if="!meters.length">
          <td :colspan="4 + months.length" class="empty-state">暂无电能表，请先重置示例数据</td>
        </tr>
      </tbody>
    </table>

    <section v-if="selectedMeter" class="detail-panel">
      <h3 class="section-title">
        {{ selectedMeter.code }} · {{ selectedMeter.item }}（{{ selectedMeter.area }}）最近走势
      </h3>
      <p class="detail-meta">
        当前倍率 {{ selectedMeter.ratio }}；
        倍率变更记录：
        <template v-if="selectedMeter.ratioLog.length">
          <span v-for="log in selectedMeter.ratioLog" :key="log.month" class="legend-item">
            {{ log.month }} 起 ×{{ log.ratio }}
          </span>
        </template>
        <template v-else>无</template>
      </p>
      <svg v-if="trendMax > 0" class="trend-chart" :viewBox="`0 0 ${trendViewWidth} 190`" role="img">
        <line x1="30" :y1="150" :x2="trendViewWidth - 10" y2="150" class="axis" />
        <g v-for="(entry, index) in selectedTrend" :key="entry.month">
          <rect
            v-if="entry.energy !== null"
            :x="trendX(index)"
            :y="trendY(entry.energy)"
            :width="barWidth"
            :height="150 - trendY(entry.energy)"
            :class="entry.abnormal ? 'bar-abnormal' : 'bar'"
          />
          <rect
            v-else
            :x="trendX(index)"
            :y="142"
            :width="barWidth"
            height="8"
            class="bar-suspended"
          />
          <text :x="trendX(index) + barWidth / 2" y="140" class="bar-value" text-anchor="middle">
            {{ entry.energy === null ? (entry.status === '停抄' ? '停抄' : '缺数') : formatEnergy(entry.energy) }}
          </text>
          <text :x="trendX(index) + barWidth / 2" y="166" class="bar-label" text-anchor="middle">
            {{ entry.month.slice(5) }}月
          </text>
        </g>
      </svg>
      <p v-else class="empty-state">该表暂无可计算的能耗，请先抄录读数</p>

      <table class="data-table">
        <thead>
          <tr><th>月份</th><th>表码</th><th>倍率快照</th><th>状态</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="reading in selectedReadings" :key="reading.id" :class="{ 'row-suspended': reading.status === '停抄' }">
            <td>{{ reading.month }}</td>
            <td>{{ reading.value === null ? '—' : reading.value }}</td>
            <td>{{ reading.ratio }}</td>
            <td>{{ reading.status }}</td>
            <td>{{ reading.note || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <h3 class="section-title">能耗明细（分项重算结果）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>表计编号</th><th>分项计量名称</th><th>月份</th><th>上月表码</th><th>本月表码</th>
          <th>倍率</th><th>能耗（kWh）</th><th>环比</th><th>状态 / 说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in detailEntries" :key="`${entry.meterId}-${entry.month}`" :class="{ 'row-abnormal': entry.abnormal, 'row-suspended': entry.status === '停抄' }">
          <td>{{ entry.code }}</td>
          <td>{{ entry.item }}</td>
          <td>{{ entry.month }}</td>
          <td>{{ entry.prevValue === null ? '—' : entry.prevValue }}</td>
          <td>{{ entry.value === null ? '—' : entry.value }}</td>
          <td>{{ entry.ratio }}</td>
          <td>{{ entry.energy === null ? '—' : formatEnergy(entry.energy) }}</td>
          <td>{{ entry.mom === null ? '—' : formatMom(entry.mom) }}</td>
          <td>
            {{ entry.status }}
            <span v-if="entry.abnormal" class="tag-abnormal">异常</span>
            <span v-if="entry.note" class="note-text">{{ entry.note }}</span>
          </td>
        </tr>
        <tr v-if="!detailEntries.length">
          <td colspan="9" class="empty-state">暂无能耗明细，抄录读数后自动重算</td>
        </tr>
      </tbody>
    </table>

    <section v-if="suspended.length" class="suspended-panel">
      <h3 class="section-title">停抄说明（设备检修等）</h3>
      <ul class="suspended-list">
        <li v-for="reading in suspended" :key="reading.id">
          {{ meterCode(reading.meterId) }} · {{ reading.month }}：{{ reading.note }}
        </li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ meters.length }} 块分项电能表 · {{ readings.length }} 条月度读数 · 异常判定：环比偏差 ≥30%（倍率调整当月除外）或表码倒走</span>
      <span>数据保存在本机浏览器</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  computeEntries,
  ledgerMonths,
  listMeters,
  listReadings,
  meterTrend,
  resetLedger,
  suspendedReadings,
  updateMeterRatio,
  upsertReading,
} from '@/data/energy-ledger'
import type { EnergyMeter, LedgerEntry, MeterReading } from '@/data/energy-ledger'

const meters = ref<EnergyMeter[]>([])
const readings = ref<MeterReading[]>([])
const selectedMeterId = ref<number | null>(null)
const message = ref('')
const errorMessage = ref('')

const readForm = reactive({
  meterId: 0,
  month: '',
  value: null as number | null,
  suspended: false,
  note: '',
})
const ratioForm = reactive({
  meterId: 0,
  ratio: 1,
  month: '',
})

const entries = computed<LedgerEntry[]>(() => computeEntries(meters.value, readings.value))
const months = computed(() => ledgerMonths(readings.value))
const latestMonth = computed(() => months.value[months.value.length - 1] ?? '')

const entryMap = computed(() => {
  const map = new Map<string, LedgerEntry>()
  for (const entry of entries.value) {
    map.set(`${entry.meterId}|${entry.month}`, entry)
  }
  return map
})

const abnormalMeterIds = computed(() => {
  const ids = new Set<number>()
  for (const entry of entries.value) {
    if (entry.abnormal && months.value.includes(entry.month)) {
      ids.add(entry.meterId)
    }
  }
  return ids
})

const latestCopied = computed(
  () =>
    readings.value.filter(
      (reading) => reading.month === latestMonth.value && reading.status === '已抄',
    ).length,
)

const suspended = computed(() => suspendedReadings(readings.value))

const detailEntries = computed(() =>
  [...entries.value].sort((a, b) => a.code.localeCompare(b.code) || b.month.localeCompare(a.month)),
)

const selectedMeter = computed(
  () => meters.value.find((meter) => meter.id === selectedMeterId.value) ?? null,
)
const selectedTrend = computed(() =>
  selectedMeterId.value === null ? [] : meterTrend(entries.value, selectedMeterId.value),
)
const selectedReadings = computed(() =>
  readings.value
    .filter((reading) => reading.meterId === selectedMeterId.value)
    .sort((a, b) => b.month.localeCompare(a.month)),
)

const barWidth = 56
const barGap = 34
const trendViewWidth = computed(() => 40 + selectedTrend.value.length * (barWidth + barGap))
const trendMax = computed(() =>
  selectedTrend.value.reduce((max, entry) => Math.max(max, entry.energy ?? 0), 0),
)

function trendX(index: number): number {
  return 40 + index * (barWidth + barGap)
}

function trendY(energy: number): number {
  return 150 - (energy / trendMax.value) * 120
}

function cellEntry(meterId: number, month: string): LedgerEntry | undefined {
  return entryMap.value.get(`${meterId}|${month}`)
}

function cellClass(meterId: number, month: string): string {
  const entry = cellEntry(meterId, month)
  if (!entry) {
    return ''
  }
  if (entry.status === '停抄') {
    return 'cell-suspended'
  }
  if (entry.abnormal) {
    return 'cell-abnormal'
  }
  return ''
}

function meterCode(meterId: number): string {
  return meters.value.find((meter) => meter.id === meterId)?.code ?? `#${meterId}`
}

function formatEnergy(energy: number | null): string {
  return energy === null ? '—' : Math.round(energy).toLocaleString('zh-CN')
}

function formatMom(mom: number | null): string {
  if (mom === null) {
    return ''
  }
  const arrow = mom > 0 ? '▲' : mom < 0 ? '▼' : '—'
  return `${arrow}${Math.abs(mom).toFixed(1)}%`
}

function selectMeter(meterId: number) {
  selectedMeterId.value = meterId
}

function submitReading() {
  message.value = ''
  errorMessage.value = ''
  const result = upsertReading({
    meterId: readForm.meterId,
    month: readForm.month,
    value: readForm.suspended ? null : readForm.value,
    note: readForm.note,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  readForm.note = ''
  reload()
}

function submitRatio() {
  message.value = ''
  errorMessage.value = ''
  const result = updateMeterRatio(ratioForm.meterId, ratioForm.ratio, ratioForm.month)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function recalc() {
  reload()
  message.value = `已按当前抄表读数与倍率快照重算，能耗明细共 ${entries.value.length} 条，结果见下方明细表`
}

function resetAll() {
  resetLedger()
  message.value = '已恢复示例数据'
  errorMessage.value = ''
  reload()
}

function exportCsv() {
  const header = ['表计编号', '分项计量名称', '所在区域', '当前倍率', ...months.value]
  const lines = [header.join(',')]
  for (const meter of meters.value) {
    const cells = months.value.map((month) => {
      const entry = cellEntry(meter.id, month)
      if (!entry) {
        return '—'
      }
      if (entry.status === '停抄') {
        return `停抄(${entry.note})`
      }
      return entry.energy === null ? '—' : String(Math.round(entry.energy))
    })
    lines.push([meter.code, meter.item, meter.area, meter.ratio, ...cells].join(','))
  }
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '厂用电分项能耗台账.csv'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function reload() {
  meters.value = listMeters()
  readings.value = listReadings()
  if (!meters.value.length) {
    return
  }
  if (!readForm.meterId || !meters.value.some((meter) => meter.id === readForm.meterId)) {
    readForm.meterId = meters.value[0].id
  }
  if (!ratioForm.meterId || !meters.value.some((meter) => meter.id === ratioForm.meterId)) {
    ratioForm.meterId = meters.value[0].id
  }
  const ratioMeter = meters.value.find((meter) => meter.id === ratioForm.meterId)
  if (ratioMeter) {
    ratioForm.ratio = ratioMeter.ratio
  }
  if (!readForm.month) {
    readForm.month = latestMonth.value
  }
  if (!ratioForm.month) {
    ratioForm.month = latestMonth.value
  }
  if (selectedMeterId.value === null || !meters.value.some((meter) => meter.id === selectedMeterId.value)) {
    const firstAbnormal = meters.value.find((meter) => abnormalMeterIds.value.has(meter.id))
    selectedMeterId.value = (firstAbnormal ?? meters.value[0]).id
  }
}

onMounted(reload)
</script>

<style scoped>
.section-title {
  font-size: 14px;
  margin: 18px 0 8px;
}
.matrix-table tbody tr {
  cursor: pointer;
}
.row-selected td {
  background: #eef4ff;
}
.row-abnormal td {
  background: #fff7ed;
}
.cell-abnormal {
  background: #fee2e2;
  color: #b42318;
  font-weight: 600;
}
.cell-suspended {
  background: #f1f5f9;
  color: var(--muted);
}
.row-suspended td {
  background: #f8fafc;
  color: var(--muted);
}
.tag-abnormal {
  display: inline-block;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  background: #b42318;
  color: #fff;
  font-size: 11px;
}
.mom {
  display: block;
  font-size: 11px;
  color: #64748b;
}
.cell-abnormal .mom {
  color: #b42318;
}
.abnormal-value {
  color: #b42318;
}
.ok-text {
  color: #067647;
  font-size: 13px;
  margin: 4px 0;
}
.error-text {
  margin: 4px 0;
}
.form-hint {
  font-size: 12px;
  color: #64748b;
  align-self: center;
}
.filter-item.grow {
  flex: 1;
  min-width: 200px;
}
.filter-item input,
.filter-item select {
  min-width: 140px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.checkbox-item input {
  min-width: auto;
}
.detail-panel {
  margin-top: 16px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.detail-meta {
  font-size: 12px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.legend-item {
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 10px;
}
.trend-chart {
  width: 100%;
  max-width: 640px;
  margin: 8px 0;
}
.axis {
  stroke: #d8dee6;
  stroke-width: 1;
}
.bar {
  fill: #1f6feb;
}
.bar-abnormal {
  fill: #dc2626;
}
.bar-suspended {
  fill: #cbd5e1;
}
.bar-value {
  font-size: 10px;
  fill: #475569;
}
.bar-label {
  font-size: 11px;
  fill: #64748b;
}
.note-text {
  display: block;
  font-size: 11px;
  color: #64748b;
}
.suspended-panel {
  margin-top: 16px;
}
.suspended-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: #475569;
}
.suspended-list li {
  margin-bottom: 4px;
}
</style>
