<template>
  <div>
    <div class="pl-toolbar">
      <label>
        <span>月份</span>
        <select v-model="monthFilter">
          <option value="">全部月份</option>
          <option v-for="m in monthOptions" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label>
        <span>电能表</span>
        <select v-model.number="meterFilter">
          <option :value="0">全部表</option>
          <option v-for="meter in meters" :key="meter.id" :value="meter.id">
            {{ meter.itemName }}（{{ meter.code }}）
          </option>
        </select>
      </label>
      <label>
        <span>检索</span>
        <input v-model="keyword" placeholder="表号 / 分项 / 抄表人" />
      </label>
      <button class="btn primary" type="button" @click="openCreate">抄录本月读数</button>
    </div>

    <p class="pl-note">
      同一块电能表同一个月只能保存一条读数，重复抄录只记一次；检修月请在录入时勾选「检修停抄」，停抄记录单独说明。
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th>月份</th>
          <th>分项计量</th>
          <th>表底读数</th>
          <th>当月倍率</th>
          <th>参考电量(kWh)</th>
          <th>状态</th>
          <th>抄表人/时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in shown" :key="row.reading.id" :class="{ 'pl-cell-abn': isAbnormal(row) }">
          <td>{{ row.reading.month }}</td>
          <td style="text-align:left;">
            <strong>{{ row.meter?.itemName }}</strong>
            <span class="pl-note" style="display:block;">{{ row.meter?.code }} · {{ row.meter?.area }}</span>
          </td>
          <td>{{ row.reading.stopped ? '—' : formatNumber(row.reading.reading, 1) }}</td>
          <td>{{ row.reading.ratioSnapshot }}</td>
          <td>{{ formatNumber(row.cell?.energy ?? null) }}</td>
          <td>
            <span v-if="row.reading.stopped" class="pl-badge stop">检修停抄</span>
            <span v-if="row.reading.abnormal" class="pl-badge" style="background:#fef3c7;color:#92400e;">人工异常</span>
            <span v-if="row.reading.autoAbnormal" class="pl-badge abn">系统异常</span>
            <span v-if="isAbnormal(row)" class="pl-note" style="display:block;">
              {{ [row.reading.abnormalReason, ...row.reading.autoReasons].filter(Boolean).join('；') }}
            </span>
            <span v-if="row.reading.stopped" class="pl-note" style="display:block;">{{ row.reading.stopReason }}</span>
          </td>
          <td>{{ row.reading.reader }}<span class="pl-note" style="display:block;">{{ row.reading.readAt }}</span></td>
          <td class="row-actions">
            <button class="link" type="button" @click="openEdit(row.reading)">修改</button>
            <button class="link" type="button" @click="openMark(row.reading)">
              {{ row.reading.abnormal ? '取消异常' : '标异常' }}
            </button>
            <button class="link" type="button" @click="remove(row.reading.id)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!shown.length" class="empty-state" style="padding: 20px;">当前条件下没有抄录记录</p>
    <p v-if="message" class="error-text">{{ message }}</p>

    <ReadingDialog
      v-if="dialog"
      :initial="dialog.initial"
      :editing="dialog.editing"
      @close="dialog = null"
      @saved="onSaved"
    />
    <AbnormalDialog v-if="marking" :reading="marking" @close="marking = null" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { deleteReading, listMeters, listReadings } from '@/api/power-service'
import { buildCell, formatNumber } from '@/data/power-ledger/engine'
import { powerDB } from '@/data/power-ledger/store'
import type { EnergyCell, MeterReading, PowerMeter } from '@/data/power-ledger/types'
import AbnormalDialog from './components/AbnormalDialog.vue'
import ReadingDialog from './components/ReadingDialog.vue'

const db = powerDB()
const meters = listMeters()
const monthFilter = ref('')
const meterFilter = ref(0)
const keyword = ref('')
const message = ref('')
const tick = ref(0)

const dialog = ref<{ initial?: { meterId: number; month: string }; editing?: MeterReading | null } | null>(null)
const marking = ref<MeterReading | null>(null)

const monthOptions = computed(() => {
  void tick.value
  return [...new Set(listReadings().map((r) => r.month))].sort().reverse()
})

const shown = computed(() => {
  void tick.value
  const kw = keyword.value.trim()
  return listReadings(meterFilter.value || undefined, monthFilter.value || undefined)
    .map((reading) => {
      const meter = meters.find((m) => m.id === reading.meterId) as PowerMeter | undefined
      const cell = meter ? buildCell(meter, db.changes, db.readings, reading.month) : undefined
      return { reading, meter, cell }
    })
    .filter((row) => {
      if (kw === '') return true
      return [row.meter?.itemName ?? '', row.meter?.code ?? '', row.reading.reader].some((v) => v.includes(kw))
    })
})

function isAbnormal(row: { reading: MeterReading; cell?: EnergyCell }): boolean {
  return row.reading.abnormal || row.reading.autoAbnormal || !!row.cell?.abnormal
}
function openCreate() {
  dialog.value = { initial: { meterId: meterFilter.value || meters[0]?.id || 0, month: monthFilter.value || '2026-09' } }
}
function openEdit(reading: MeterReading) {
  dialog.value = { editing: reading }
}
function openMark(reading: MeterReading) {
  marking.value = reading
}
function remove(id: number) {
  const result = deleteReading(id)
  message.value = result.ok ? '' : result.message
  if (result.ok) tick.value += 1
}
function onSaved(text: string) {
  dialog.value = null
  marking.value = null
  message.value = text
  tick.value += 1
}
</script>
