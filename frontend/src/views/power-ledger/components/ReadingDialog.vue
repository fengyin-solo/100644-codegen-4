<template>
  <div class="pl-modal-mask" @click.self="$emit('close')">
    <div class="pl-modal">
      <h3>{{ form.id ? '修改月度抄表读数' : '月度抄表录入' }}</h3>

      <div v-if="conflict" class="pl-conflict">
        <strong>同一块表同一个月已有一条读数：</strong>{{ conflictMessage }}
        <div class="pl-modal-foot" style="margin-top: 8px;">
          <button class="btn" type="button" @click="$emit('close')">放弃</button>
          <button class="btn primary" type="button" @click="editExisting">改为编辑已有记录</button>
        </div>
      </div>

      <template v-else>
        <div class="pl-form">
          <label class="full">
            <span>电能表 / 分项计量</span>
            <select v-model.number="form.meterId" :disabled="!!form.id">
              <option v-for="meter in meters" :key="meter.id" :value="meter.id">
                {{ meter.itemName }}（{{ meter.code }} · {{ meter.area }}）
              </option>
            </select>
          </label>
          <label>
            <span>抄表月份</span>
            <input v-model="form.month" type="month" :disabled="!!form.id" />
          </label>
          <label>
            <span>抄表人</span>
            <input v-model="form.reader" placeholder="如：王建国" />
          </label>
          <label>
            <span>表底累计读数（表显值）</span>
            <input
              v-model.number="form.reading"
              type="number"
              step="0.1"
              :disabled="form.stopped"
              placeholder="检修停抄时不填"
            />
          </label>
          <label>
            <span>该月生效倍率（自动快照）</span>
            <input :value="effectiveRatio" disabled />
          </label>
          <label class="full pl-check">
            <input v-model="form.stopped" type="checkbox" />
            <span style="margin:0;">本月设备检修停抄，不抄表、不计电量</span>
          </label>
          <label v-if="form.stopped" class="full">
            <span>停抄原因 / 检修说明</span>
            <textarea v-model="form.stopReason" placeholder="如：1#一次风机大修，2026-08 整月停运"></textarea>
          </label>
          <label class="full pl-check">
            <input v-model="form.abnormal" type="checkbox" />
            <span style="margin:0;">人工标记为能耗异常路线</span>
          </label>
          <label v-if="form.abnormal" class="full">
            <span>异常说明</span>
            <textarea v-model="form.abnormalReason" placeholder="如：现场核对运行电流偏大，待排查"></textarea>
          </label>
        </div>

        <p class="pl-note">
          历史留痕：保存时按当月生效倍率生成快照；之后倍率再改，本月及历史月份的电量不会跟着变。
        </p>
        <p v-if="message" class="error-text">{{ message }}</p>

        <div class="pl-modal-foot">
          <button class="btn" type="button" @click="$emit('close')">取消</button>
          <button class="btn primary" type="button" @click="submit">保存读数</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { listMeters, saveReading } from '@/api/power-service'
import { powerDB } from '@/data/power-ledger/store'
import { ratioAt } from '@/data/power-ledger/engine'
import type { MeterReading, SaveReadingInput } from '@/data/power-ledger/types'

const props = defineProps<{
  initial?: { meterId: number; month: string; stopped?: boolean; stopReason?: string }
  editing?: MeterReading | null
}>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const meters = listMeters()
const message = ref('')

const form = reactive<SaveReadingInput>({
  id: undefined,
  meterId: props.editing?.meterId ?? props.initial?.meterId ?? meters[0]?.id ?? 0,
  month: props.editing?.month ?? props.initial?.month ?? newMonth(),
  reading: props.editing ? props.editing.reading : null,
  reader: props.editing?.reader ?? '',
  stopped: props.editing?.stopped ?? props.initial?.stopped ?? false,
  stopReason: props.editing?.stopReason ?? props.initial?.stopReason ?? '',
  abnormal: props.editing?.abnormal ?? false,
  abnormalReason: props.editing?.abnormalReason ?? '',
})

watch(
  () => form.stopped,
  (stopped) => {
    if (stopped) form.reading = null
  },
)

const db = powerDB()
const effectiveRatio = computed(() => {
  const meter = db.meters.find((m) => m.id === form.meterId)
  return meter ? ratioAt(meter, db.changes, form.month) : '—'
})

const conflict = ref<number | null>(null)
const conflictMessage = ref('')

function newMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`
}

function submit() {
  message.value = ''
  const result = saveReading({ ...form })
  if (!result.ok) {
    if (result.existingId) {
      conflict.value = result.existingId
      conflictMessage.value = result.message
      return
    }
    message.value = result.message
    return
  }
  emit('saved', result.message)
}

function editExisting() {
  const existing = powerDB().readings.find((r) => r.id === conflict.value)
  if (!existing) return
  form.id = existing.id
  form.meterId = existing.meterId
  form.month = existing.month
  form.reading = existing.reading
  form.reader = existing.reader
  form.stopped = existing.stopped
  form.stopReason = existing.stopReason
  form.abnormal = existing.abnormal
  form.abnormalReason = existing.abnormalReason
  conflict.value = null
  conflictMessage.value = ''
}
</script>

<style scoped>
.pl-conflict { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px; font-size: 13px; }
</style>
