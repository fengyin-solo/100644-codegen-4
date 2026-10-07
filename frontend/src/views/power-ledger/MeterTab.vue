<template>
  <div>
    <div class="pl-toolbar">
      <button class="btn primary" type="button" @click="adding = true">新挂电能表</button>
      <span class="pl-note" style="margin-left: auto;">每块表挂分项计量名称、所在区域与综合倍率；倍率变更逐条留痕，历史月份按当时倍率保留。</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>表号</th>
          <th>分项计量名称</th>
          <th>所在区域</th>
          <th>类别</th>
          <th>建档倍率</th>
          <th>当前倍率</th>
          <th>倍率变更记录</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="meter in meters" :key="meter.id">
          <td>{{ meter.code }}</td>
          <td><strong>{{ meter.itemName }}</strong></td>
          <td>{{ meter.area }}</td>
          <td><span class="pl-badge" :class="meter.kind === 'total' ? 'total' : 'sub'">{{ meter.kind === 'total' ? '总表' : '分项' }}</span></td>
          <td>{{ meter.baseRatio }}</td>
          <td><strong>{{ currentRatio(meter.id) }}</strong></td>
          <td style="text-align:left;">
            <div v-for="change in byMeter(meter.id)" :key="change.id" class="pl-note">
              {{ change.effectiveMonth }} 起 {{ change.ratio }}（{{ change.reason }}）
            </div>
            <span v-if="!byMeter(meter.id).length" class="pl-note">未调整过</span>
          </td>
          <td>{{ meter.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="target = meter">改倍率</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="adding" class="pl-modal-mask" @click.self="adding = false">
      <div class="pl-modal">
        <h3>新挂电能表</h3>
        <div class="pl-form">
          <label><span>电能表编号</span><input v-model="form.code" placeholder="如 EM-040" /></label>
          <label><span>类别</span>
            <select v-model="form.kind">
              <option value="sub">分项表</option>
              <option value="total">总表</option>
            </select>
          </label>
          <label class="full"><span>分项计量名称</span><input v-model="form.itemName" placeholder="如：3#一次风机用电" /></label>
          <label><span>所在区域</span><input v-model="form.area" placeholder="如：焚烧车间" /></label>
          <label><span>初始综合倍率</span><input v-model.number="form.baseRatio" type="number" min="1" /></label>
        </div>
        <p v-if="formMessage" class="error-text">{{ formMessage }}</p>
        <div class="pl-modal-foot">
          <button class="btn" type="button" @click="adding = false">取消</button>
          <button class="btn primary" type="button" @click="saveMeter">保存挂表</button>
        </div>
      </div>
    </div>

    <div v-if="target" class="pl-modal-mask" @click.self="target = null">
      <div class="pl-modal">
        <h3>登记倍率变更 · {{ target.itemName }}（{{ target.code }}）</h3>
        <p class="pl-note">
          当前倍率 {{ currentRatio(target.id) }}。已抄到 {{ latestMonth(target.id) }}，
          生效月份只能选在这之后；历史读数按当时倍率保留，不追溯修改。
        </p>
        <div class="pl-form">
          <label>
            <span>生效月份（含本月）</span>
            <input v-model="ratioForm.effectiveMonth" type="month" />
          </label>
          <label>
            <span>新综合倍率</span>
            <input v-model.number="ratioForm.ratio" type="number" min="0.1" step="0.1" />
          </label>
          <label class="full">
            <span>变更原因</span>
            <textarea v-model="ratioForm.reason" placeholder="如：电流互感器更换，核定综合倍率由 100 调整为 120"></textarea>
          </label>
        </div>
        <p v-if="ratioMessage" class="error-text">{{ ratioMessage }}</p>
        <div class="pl-modal-foot">
          <button class="btn" type="button" @click="target = null">取消</button>
          <button class="btn primary" type="button" @click="saveRatio">登记变更</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'

import { addMeter, addRatioChange, listChanges } from '@/api/power-service'
import { powerDB } from '@/data/power-ledger/store'
import type { PowerMeter } from '@/data/power-ledger/types'

const db = powerDB()
const meters = db.meters
const adding = ref(false)
const target = ref<PowerMeter | null>(null)
const formMessage = ref('')
const ratioMessage = ref('')
const tick = ref(0)

const form = reactive({ code: '', itemName: '', area: '', kind: 'sub' as 'total' | 'sub', baseRatio: 1 })
const ratioForm = reactive({ effectiveMonth: '2026-10', ratio: 1, reason: '' })

function byMeter(meterId: number) {
  void tick.value
  return listChanges(meterId)
}
function currentRatio(meterId: number): number {
  const meter = db.meters.find((m) => m.id === meterId)
  if (!meter) return 0
  const valid = db.changes
    .filter((c) => c.meterId === meterId)
    .sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? 1 : -1))
  return valid.length ? valid[0].ratio : meter.baseRatio
}
function latestMonth(meterId: number): string {
  const months = db.readings.filter((r) => r.meterId === meterId).map((r) => r.month).sort()
  return months.length ? months[months.length - 1] : '尚无读数'
}
function saveMeter() {
  const result = addMeter({ ...form })
  if (!result.ok) {
    formMessage.value = result.message
    return
  }
  formMessage.value = ''
  adding.value = false
  tick.value += 1
  window.alert(result.message)
}
function saveRatio() {
  if (!target.value) return
  const result = addRatioChange(target.value.id, ratioForm.effectiveMonth, ratioForm.ratio, ratioForm.reason)
  if (!result.ok) {
    ratioMessage.value = result.message
    return
  }
  ratioMessage.value = ''
  target.value = null
  tick.value += 1
  window.alert(result.message)
}
</script>
