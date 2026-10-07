<template>
  <div>
    <div class="pl-toolbar">
      <label>
        <span>截止月份</span>
        <input v-model="endMonth" type="month" />
      </label>
      <label>
        <span>展示月数</span>
        <select v-model.number="span">
          <option :value="6">近 6 个月</option>
          <option :value="9">近 9 个月</option>
          <option :value="12">近 12 个月</option>
        </select>
      </label>
      <label>
        <span>所在区域</span>
        <select v-model="area">
          <option value="">全部区域</option>
          <option v-for="item in areas" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label>
        <span>检索分项/表号</span>
        <input v-model="keyword" placeholder="如：引风机 / EM-012" />
      </label>
      <button class="btn primary" type="button" @click="recalc">分项重算</button>
    </div>

    <p class="status-legend">
      <span class="legend-item">正常：表底 / 月电量</span>
      <span class="legend-item bad">红底：环比突增 ≥50%、表底倒退或人工标记</span>
      <span class="legend-item stop">蓝底：检修停抄，不计电量</span>
      <span class="legend-item">灰底：当月未抄</span>
      <span class="legend-item warn">整行左侧红条：该路线近窗口内出现异常，点单元格看走势</span>
    </p>

    <table class="pl-matrix">
      <thead>
        <tr>
          <th class="name">分项计量（表号 / 区域 / 当前倍率）</th>
          <th v-for="month in matrix.monthCols" :key="month">{{ month }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in matrix.rows"
          :key="row.meter.id"
          :class="{ 'pl-row-flag': hasAbnormal(row.cells) }"
        >
          <td class="name">
            <div>
              <strong>{{ row.meter.itemName }}</strong>
              <span class="pl-badge" :class="row.meter.kind === 'total' ? 'total' : 'sub'" style="margin-left: 6px;">
                {{ row.meter.kind === 'total' ? '总表' : '分项' }}
              </span>
              <span v-if="hasAbnormal(row.cells)" class="pl-badge abn" style="margin-left: 4px;">异常路线</span>
            </div>
            <div class="pl-note">{{ row.meter.code }} · {{ row.meter.area }} · 倍率 {{ currentRatio(row.meter.id) }}</div>
          </td>
          <td
            v-for="cell in row.cells"
            :key="cell.month"
            :class="cellClass(cell)"
            style="cursor: pointer;"
            @click="openTrend(row.meter)"
          >
            <template v-if="cell.stopped">
              <span class="pl-cell-energy">停抄</span>
              <span class="pl-cell-reading">{{ cell.reasons[0] || '检修' }}</span>
            </template>
            <template v-else-if="cell.missing">
              <span class="pl-cell-energy">未抄</span>
            </template>
            <template v-else>
              <span class="pl-cell-energy">{{ formatNumber(cell.energy) }}</span>
              <span class="pl-cell-reading">
                表底 {{ formatNumber(cell.reading, 1) }} ×{{ cell.ratioSnapshot }}
              </span>
              <span v-if="cell.mom !== null" :class="cell.mom >= 0 ? 'pl-mom-up' : 'pl-mom-down'" style="font-size: 11px;">
                {{ formatMom(cell.mom) }}
              </span>
              <span v-if="cell.crossGap" class="pl-cell-reading">{{ cell.gapLabel }}</span>
            </template>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td class="name"><strong>分项合计</strong></td>
          <td v-for="(total, month) in subtotals" :key="month">
            <strong>{{ formatNumber(total) }}</strong>
          </td>
        </tr>
        <tr>
          <td class="name"><strong>总表 − 分项（计量差）</strong></td>
          <td v-for="month in matrix.monthCols" :key="month" :class="diffClass(month)">
            {{ formatNumber(differences[month]) }}
          </td>
        </tr>
      </tfoot>
    </table>
    <p class="pl-note">单位 kWh；点击任意单元格可查看该路线近 12 个月走势。停抄当月电量为空，复抄月电量与上期有效读数差分，跨停抄月不做环比自动判异。</p>

    <TrendDialog v-if="trendMeter" :meter="trendMeter" :changes="changes" :end-month="endMonth" @close="trendMeter = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { ledgerMatrix, listAreas, recalcAll } from '@/api/power-service'
import { formatMom, formatNumber } from '@/data/power-ledger/engine'
import { powerDB } from '@/data/power-ledger/store'
import type { EnergyCell, PowerMeter, RatioChange } from '@/data/power-ledger/types'
import TrendDialog from './components/TrendDialog.vue'

const endMonth = ref('2026-09')
const span = ref(6)
const area = ref('')
const keyword = ref('')
const areas = listAreas()
const trendMeter = ref<PowerMeter | null>(null)
const toast = ref('')

const db = powerDB()
const changes = computed<RatioChange[]>(() => db.changes)

const matrix = computed(() => ledgerMatrix(span.value, endMonth.value, area.value, keyword.value))

const subtotals = computed<Record<string, number | null>>(() => {
  const result: Record<string, number | null> = {}
  for (const month of matrix.value.monthCols) {
    const energies = matrix.value.rows
      .filter((r) => r.meter.kind === 'sub')
      .map((r) => r.cells.find((c) => c.month === month)?.energy ?? null)
    result[month] = energies.every((v) => v === null) ? null : energies.reduce<number>((sum, v) => sum + (v ?? 0), 0)
  }
  return result
})

const differences = computed<Record<string, number | null>>(() => {
  const result: Record<string, number | null> = {}
  for (const month of matrix.value.monthCols) {
    const totalRow = matrix.value.rows.find((r) => r.meter.kind === 'total')
    const total = totalRow?.cells.find((c) => c.month === month)?.energy ?? null
    const sub = subtotals.value[month]
    result[month] = total === null || sub === null ? null : total - sub
  }
  return result
})

function currentRatio(meterId: number): number {
  const meter = db.meters.find((m) => m.id === meterId)
  if (!meter) return 0
  const valid = db.changes
    .filter((c) => c.meterId === meterId && c.effectiveMonth <= endMonth.value)
    .sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? 1 : -1))
  return valid.length ? valid[0].ratio : meter.baseRatio
}

function hasAbnormal(cells: EnergyCell[]): boolean {
  return cells.some((c) => c.abnormal)
}
function cellClass(cell: EnergyCell): Record<string, boolean> {
  return {
    'pl-cell-abn': cell.abnormal,
    'pl-cell-stop': cell.stopped,
    'pl-cell-miss': cell.missing,
  }
}
function diffClass(month: string): string {
  const diff = differences.value[month]
  const totalRow = matrix.value.rows.find((r) => r.meter.kind === 'total')
  const total = totalRow?.cells.find((c) => c.month === month)?.energy ?? null
  if (diff === null || total === null || total <= 0) return ''
  return Math.abs(diff) / total > 0.15 ? 'pl-mom-up' : ''
}
function openTrend(meter: PowerMeter) {
  trendMeter.value = meter
}
function recalc() {
  const report = recalcAll(endMonth.value)
  toast.value = `重算完成：系统判定异常 ${report.autoAbnormal} 条，人工异常 ${report.manualAbnormal} 条，当月停抄 ${report.stopped} 块，未抄 ${report.missingLatest} 块`
  window.alert(toast.value)
}
</script>

<style scoped>
.pl-row-flag td:first-child { box-shadow: inset 3px 0 0 #dc2626; }
tfoot td { background: #f8fafc; }
</style>
