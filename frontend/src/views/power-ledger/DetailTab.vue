<template>
  <div>
    <div class="pl-toolbar">
      <label>
        <span>台账月份</span>
        <input v-model="month" type="month" />
      </label>
      <label>
        <span>只看</span>
        <select v-model="scope">
          <option value="all">全部路线</option>
          <option value="abnormal">仅异常路线</option>
          <option value="stopped">仅停抄/未抄</option>
        </select>
      </label>
      <button class="btn primary" type="button" @click="recalc">按分项重算本月</button>
    </div>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">分项电量合计</span><strong class="stat-value">{{ formatNumber(subTotal) }}</strong></article>
      <article class="stat-card"><span class="stat-label">总表电量</span><strong class="stat-value">{{ formatNumber(totalEnergy) }}</strong></article>
      <article class="stat-card"><span class="stat-label">总-分计量差</span><strong class="stat-value" :class="diffWarn ? 'pl-mom-up' : ''">{{ formatNumber(diff) }}</strong></article>
      <article class="stat-card"><span class="stat-label">异常路线</span><strong class="stat-value pl-mom-up">{{ abnormalCount }}</strong></article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>分项计量</th>
          <th>区域</th>
          <th>上期表底</th>
          <th>本月表底</th>
          <th>倍率(当月快照)</th>
          <th>本月电量(kWh)</th>
          <th>环比</th>
          <th>状态/异常说明</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in shownRows" :key="item.meter.id" :class="{ 'pl-cell-abn': item.cell.abnormal }">
          <td>
            <strong>{{ item.meter.itemName }}</strong>
            <span class="pl-note" style="display:block;">{{ item.meter.code }}</span>
          </td>
          <td>{{ item.meter.area }}</td>
          <td>{{ prevReading(item.meter.id) }}</td>
          <td>{{ item.cell.stopped ? '—' : formatNumber(item.cell.reading, 1) }}</td>
          <td>{{ item.cell.ratioSnapshot ?? '—' }}</td>
          <td><strong>{{ formatNumber(item.cell.energy) }}</strong></td>
          <td :class="item.cell.mom !== null && item.cell.mom >= 0 ? 'pl-mom-up' : 'pl-mom-down'">
            {{ formatMom(item.cell.mom) }}
          </td>
          <td style="text-align: left;">
            <span v-if="item.cell.abnormal" class="pl-badge abn">异常</span>
            <span v-if="item.cell.manual" class="pl-badge" style="background:#fef3c7;color:#92400e;">人工</span>
            <span v-if="item.cell.stopped" class="pl-badge stop">检修停抄</span>
            <span v-if="item.cell.missing" class="pl-badge" style="background:#f1f5f9;color:#64748b;">未抄</span>
            <span v-if="item.cell.crossGap" class="pl-note" style="display:block;">{{ item.cell.gapLabel }}</span>
            <span v-for="reason in item.cell.reasons" :key="reason" class="pl-note" style="display:block;">{{ reason }}</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="trendMeter = item.meter">走势</button>
            <button
              v-if="!item.cell.stopped && !item.cell.missing"
              class="link"
              type="button"
              @click="mark(item)"
            >
              {{ item.cell.manual ? '取消标记' : '标记异常' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="message" class="error-text">{{ message }}</p>

    <TrendDialog v-if="trendMeter" :meter="trendMeter" :changes="db.changes" :end-month="month" @close="trendMeter = null" />
    <AbnormalDialog v-if="marking" :reading="marking" @close="marking = null" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { monthDetails, recalcAll } from '@/api/power-service'
import { formatMom, formatNumber } from '@/data/power-ledger/engine'
import { powerDB } from '@/data/power-ledger/store'
import type { MeterReading, PowerMeter } from '@/data/power-ledger/types'
import AbnormalDialog from './components/AbnormalDialog.vue'
import TrendDialog from './components/TrendDialog.vue'

const month = ref('2026-09')
const scope = ref<'all' | 'abnormal' | 'stopped'>('all')
const message = ref('')
const trendMeter = ref<PowerMeter | null>(null)
const marking = ref<MeterReading | null>(null)
const db = powerDB()

const rows = computed(() => monthDetails(month.value))
const shownRows = computed(() => {
  if (scope.value === 'abnormal') return rows.value.filter((r) => r.cell.abnormal)
  if (scope.value === 'stopped') return rows.value.filter((r) => r.cell.stopped || r.cell.missing)
  return rows.value
})

const subRows = computed(() => rows.value.filter((r) => r.meter.kind === 'sub'))
const subTotal = computed(() => subRows.value.reduce((sum, r) => sum + (r.cell.energy ?? 0), 0))
const totalEnergy = computed(() => rows.value.find((r) => r.meter.kind === 'total')?.cell.energy ?? null)
const diff = computed(() => (totalEnergy.value === null ? null : totalEnergy.value - subTotal.value))
const diffWarn = computed(() => totalEnergy.value !== null && Math.abs(diff.value ?? 0) / Math.max(totalEnergy.value, 1) > 0.15)
const abnormalCount = computed(() => rows.value.filter((r) => r.cell.abnormal).length)

function prevReading(meterId: number): string {
  const prev = db.readings
    .filter((r) => r.meterId === meterId && r.month < month.value && !r.stopped && r.reading !== null)
    .sort((a, b) => (a.month < b.month ? 1 : -1))[0]
  return prev ? formatNumber(prev.reading, 1) : '—'
}

function mark(item: { meter: PowerMeter }) {
  const reading = db.readings.find((r) => r.meterId === item.meter.id && r.month === month.value)
  if (reading) marking.value = reading
}
function onSaved(text: string) {
  marking.value = null
  message.value = text
}
function recalc() {
  recalcAll(month.value)
  message.value = ''
  window.alert(`已按 ${month.value} 重新分摊各分项电量，异常判定同步更新`)
}
</script>
