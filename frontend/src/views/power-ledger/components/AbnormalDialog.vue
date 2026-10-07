<template>
  <div class="pl-modal-mask" @click.self="$emit('close')">
    <div class="pl-modal">
      <h3>{{ reading.abnormal ? '取消异常标记' : '标记能耗异常' }}</h3>
      <p class="pl-note">
        电能表：{{ meterLabel }} ｜ 月份：{{ reading.month }}
      </p>
      <div v-if="systemReasons.length" class="pl-sysbox">
        <strong>系统已判定：</strong>
        <ul>
          <li v-for="reason in systemReasons" :key="reason">{{ reason }}</li>
        </ul>
      </div>
      <div class="pl-form" style="margin-top: 10px;">
        <label class="full">
          <span>异常说明（取消标记时可不填）</span>
          <textarea v-model="reason" :placeholder="reading.abnormal ? reading.abnormalReason : '说明异常现象与排查方向'"></textarea>
        </label>
      </div>
      <p v-if="message" class="error-text">{{ message }}</p>
      <div class="pl-modal-foot">
        <button class="btn" type="button" @click="$emit('close')">关闭</button>
        <button class="btn primary" type="button" @click="submit">
          {{ reading.abnormal ? '取消异常标记' : '确认标记' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { listMeters, setManualAbnormal } from '@/api/power-service'
import type { MeterReading } from '@/data/power-ledger/types'

const props = defineProps<{ reading: MeterReading }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const meters = listMeters()
const meterLabel = (() => {
  const meter = meters.find((m) => m.id === props.reading.meterId)
  return meter ? `${meter.itemName}（${meter.code}）` : `表#${props.reading.meterId}`
})()
const systemReasons = props.reading.autoReasons.filter((r) => !r.startsWith('检修停抄') && !r.startsWith('无上期'))
const reason = ref(props.reading.abnormalReason)
const message = ref('')

function submit() {
  const result = setManualAbnormal(props.reading.id, !props.reading.abnormal, reason.value)
  if (!result.ok) {
    message.value = result.message
    return
  }
  emit('saved', result.message)
}
</script>

<style scoped>
.pl-sysbox { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; font-size: 12px; }
.pl-sysbox ul { margin: 4px 0 0; padding-left: 18px; }
</style>
