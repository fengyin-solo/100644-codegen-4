<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>厂用电分项能耗台账</h2>
        <p class="page-desc">
          每块电能表挂分项计量名称、所在区域与倍率；月度读数按分项并排摊开，一眼看出哪一路在涨。
          同一块表同一个月只记一条读数，历史月份按当时倍率保留，检修停抄单独说明。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetAll">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">在册电能表</span><strong class="stat-value">{{ stats.meterCount }}</strong></article>
      <article class="stat-card"><span class="stat-label">{{ currentMonth }} 分项电量合计</span><strong class="stat-value">{{ formatNumber(stats.subTotal) }}</strong></article>
      <article class="stat-card"><span class="stat-label">{{ currentMonth }} 总表电量</span><strong class="stat-value">{{ formatNumber(stats.totalEnergy) }}</strong></article>
      <article class="stat-card"><span class="stat-label">异常路线（全表）</span><strong class="stat-value pl-mom-up">{{ stats.abnormalMeters }}</strong></article>
      <article class="stat-card"><span class="stat-label">检修停抄表（本月）</span><strong class="stat-value">{{ stats.stoppedCount }}</strong></article>
    </div>

    <nav class="pl-tabs">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="pl-tab"
        :class="{ active: active === item.key }"
        type="button"
        @click="active = item.key"
      >
        {{ item.label }}
      </button>
    </nav>

    <LedgerTab v-if="active === 'ledger'" />
    <DetailTab v-else-if="active === 'detail'" />
    <ReadingTab v-else-if="active === 'reading'" />
    <StopTab v-else-if="active === 'stop'" />
    <MeterTab v-else-if="active === 'meter'" />

    <footer class="page-foot">
      <span>台账数据保存在本机浏览器（localStorage: waste-to-energy-plant:power-ledger），清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { cellsForMonth, formatNumber } from '@/data/power-ledger/engine'
import { resetLedger } from '@/api/power-service'
import { powerDB } from '@/data/power-ledger/store'
import LedgerTab from './LedgerTab.vue'
import DetailTab from './DetailTab.vue'
import ReadingTab from './ReadingTab.vue'
import StopTab from './StopTab.vue'
import MeterTab from './MeterTab.vue'

const currentMonth = '2026-09'
const active = ref<'ledger' | 'detail' | 'reading' | 'stop' | 'meter'>('ledger')
const tabs = [
  { key: 'ledger' as const, label: '电耗台账（分项×月份）' },
  { key: 'detail' as const, label: '能耗明细' },
  { key: 'reading' as const, label: '月度抄表' },
  { key: 'stop' as const, label: '检修停抄' },
  { key: 'meter' as const, label: '电能表与倍率' },
]

const tick = ref(0)
const db = powerDB()
const stats = computed(() => {
  void tick.value
  const cells = cellsForMonth(db.meters, db.changes, db.readings, currentMonth)
  const subMeters = db.meters.filter((m) => m.kind === 'sub')
  const subTotal = cells
    .filter((c) => subMeters.some((m) => m.id === c.meterId))
    .reduce((sum, c) => sum + (c.energy ?? 0), 0)
  const totalEnergy = cells.find((c) => db.meters.find((m) => m.id === c.meterId)?.kind === 'total')?.energy ?? null
  const abnormalMeterIds = new Set(
    db.readings.filter((r) => r.abnormal || r.autoAbnormal).map((r) => r.meterId),
  )
  return {
    meterCount: db.meters.length,
    subTotal,
    totalEnergy,
    abnormalMeters: abnormalMeterIds.size,
    stoppedCount: cells.filter((c) => c.stopped).length,
  }
})

function resetAll() {
  if (!window.confirm('确定恢复出厂用电台账的示例数据？当前抄录与倍率变更都会被清空。')) return
  resetLedger()
  tick.value += 1
  window.alert('已恢复示例数据')
}
</script>
