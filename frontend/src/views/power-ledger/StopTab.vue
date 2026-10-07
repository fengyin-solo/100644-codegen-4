<template>
  <div>
    <div class="pl-toolbar">
      <label>
        <span>月份</span>
        <input v-model="month" type="month" />
      </label>
      <button class="btn primary" type="button" @click="registerStop">登记当月停抄</button>
    </div>

    <p class="pl-note">
      设备检修期间无法抄表的月份在这里单独登记：当月不抄表、不计电量；复抄月自动与最近有效读数差分，
      并标注「跨停抄月」，跨期月份不做环比突增判异，避免把检修后的补量误报成异常。
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th>停抄月份</th>
          <th>分项计量</th>
          <th>表号 / 区域</th>
          <th>停抄原因 / 检修说明</th>
          <th>复抄情况</th>
          <th>登记人/时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in stopRows" :key="row.reading.id">
          <td>{{ row.reading.month }}</td>
          <td><strong>{{ row.meter?.itemName }}</strong></td>
          <td>{{ row.meter?.code }} · {{ row.meter?.area }}</td>
          <td style="text-align:left;">{{ row.reading.stopReason || '—' }}</td>
          <td style="text-align:left;">
            <template v-if="row.resume">
              <span class="pl-badge" style="background:#ecfdf5;color:#065f46;">已于 {{ row.resume.month }} 复抄</span>
              <span class="pl-note" style="display:block;">
                复抄表底 {{ formatNumber(row.resume.reading, 1) }}，跨停抄期电量 {{ formatNumber(row.resumeEnergy) }} kWh（不计环比）
              </span>
            </template>
            <span v-else class="pl-note">尚未复抄</span>
          </td>
          <td>{{ row.reading.reader }}<span class="pl-note" style="display:block;">{{ row.reading.readAt }}</span></td>
          <td class="row-actions">
            <button class="link" type="button" @click="edit(row.reading)">修改说明</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!stopRows.length" class="empty-state" style="padding: 20px;">{{ month }} 没有检修停抄记录</p>
    <p v-if="message" class="error-text">{{ message }}</p>

    <ReadingDialog
      v-if="dialog"
      :initial="dialog.initial"
      :editing="dialog.editing"
      @close="dialog = null"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { listMeters, listReadings } from '@/api/power-service'
import { formatNumber } from '@/data/power-ledger/engine'
import { powerDB } from '@/data/power-ledger/store'
import type { MeterReading, PowerMeter } from '@/data/power-ledger/types'
import ReadingDialog from './components/ReadingDialog.vue'

const db = powerDB()
const meters = listMeters()
const month = ref('2026-08')
const tick = ref(0)
const message = ref('')
const dialog = ref<{ initial?: { meterId: number; month: string; stopped?: boolean; stopReason?: string }; editing?: MeterReading | null } | null>(null)

const stopRows = computed(() => {
  void tick.value
  return listReadings(undefined, month.value)
    .filter((r) => r.stopped)
    .map((reading) => {
      const meter = meters.find((m) => m.id === reading.meterId) as PowerMeter | undefined
      const resume = db.readings
        .filter((r) => r.meterId === reading.meterId && r.month > reading.month && !r.stopped && r.reading !== null)
        .sort((a, b) => (a.month < b.month ? -1 : 1))[0]
      let resumeEnergy: number | null = null
      if (resume) {
        const prev = db.readings
          .filter((r) => r.meterId === reading.meterId && r.month < resume.month && !r.stopped && r.reading !== null)
          .sort((a, b) => (a.month < b.month ? 1 : -1))[0]
        resumeEnergy = prev ? (resume.reading! - prev.reading!) * resume.ratioSnapshot : null
      }
      return { reading, meter, resume, resumeEnergy }
    })
})

function registerStop() {
  dialog.value = { initial: { meterId: meters[0]?.id ?? 0, month: month.value, stopped: true, stopReason: '设备检修停抄' } }
}
function edit(reading: MeterReading) {
  dialog.value = { editing: reading }
}
function onSaved(text: string) {
  dialog.value = null
  message.value = text
  tick.value += 1
}
</script>
