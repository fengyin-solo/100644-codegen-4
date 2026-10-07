<template>
  <div class="pl-modal-mask" @click.self="$emit('close')">
    <div class="pl-modal wide">
      <h3>{{ meter.itemName }}（{{ meter.code }}）· 近 {{ cells.length }} 个月能耗走势</h3>
      <p class="pl-note">
        所在区域：{{ meter.area }} ｜ 当前倍率：{{ currentRatio }}
        ｜ 历史各月按当时倍率快照计算，倍率调整不追溯
      </p>

      <div class="pl-spark">
        <div
          v-for="cell in cells"
          :key="cell.month"
          class="pl-spark-bar"
          :class="{ abn: cell.abnormal, zero: cell.energy === null || cell.stopped }"
          :style="{ height: barHeight(cell.energy) + '%' }"
          :title="`${cell.month}：${energyText(cell)}`"
        />
      </div>
      <div class="pl-spark-labels">
        <span v-for="cell in cells" :key="cell.month">{{ cell.month.slice(5) }}月</span>
      </div>

      <table class="data-table" style="margin-top: 12px;">
        <thead>
          <tr><th>月份</th><th>表底读数</th><th>当月倍率</th><th>电量(kWh)</th><th>环比</th><th>状态/说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="cell in [...cells].reverse()" :key="cell.month" :class="{ 'pl-cell-abn': cell.abnormal }">
            <td>{{ cell.month }}</td>
            <td>{{ cell.stopped ? '—' : formatNumber(cell.reading, 1) }}</td>
            <td>{{ cell.ratioSnapshot ?? '—' }}</td>
            <td>{{ formatNumber(cell.energy) }}</td>
            <td :class="momClass(cell.mom)">{{ formatMom(cell.mom) }}</td>
            <td style="text-align: left;">
              <span v-if="cell.stopped" class="pl-badge stop">检修停抄</span>
              <span v-if="cell.abnormal" class="pl-badge abn">异常</span>
              <span v-if="cell.crossGap" class="pl-note">{{ cell.gapLabel }}</span>
              <span v-if="cell.reasons.length" class="pl-note">{{ cell.reasons.join('；') }}</span>
              <span v-if="!cell.stopped && !cell.abnormal && !cell.reasons.length" class="pl-note">正常</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="pl-modal-foot">
        <button class="btn" type="button" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { meterTrend } from '@/api/power-service'
import { formatMom, formatNumber } from '@/data/power-ledger/engine'
import type { EnergyCell, PowerMeter, RatioChange } from '@/data/power-ledger/types'

const props = defineProps<{
  meter: PowerMeter
  changes: RatioChange[]
  endMonth: string
}>()
defineEmits<{ close: [] }>()

const cells = computed<EnergyCell[]>(() => meterTrend(props.meter.id, 12, props.endMonth))
const maxEnergy = computed(() => Math.max(...cells.value.map((c) => c.energy ?? 0), 1))
const currentRatio = computed(() => {
  const valid = [...props.changes]
    .filter((c) => c.meterId === props.meter.id && c.effectiveMonth <= props.endMonth)
    .sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? 1 : -1))
  return valid.length ? valid[0].ratio : props.meter.baseRatio
})

function barHeight(energy: number | null): number {
  if (energy === null) return 4
  return Math.max(6, Math.round((energy / maxEnergy.value) * 100))
}
function energyText(cell: EnergyCell): string {
  if (cell.stopped) return `${cell.month} 检修停抄`
  if (cell.energy === null) return `${cell.month} 不计电量`
  return `${cell.month} ${formatNumber(cell.energy)} kWh`
}
function momClass(mom: number | null): string {
  if (mom === null) return ''
  return mom >= 0 ? 'pl-mom-up' : 'pl-mom-down'
}
</script>
