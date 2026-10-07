import { buildCell, cellsForMonth, ratioAt, seriesForMeter, shiftMonth } from '@/data/power-ledger/engine'
import { buildSeed } from '@/data/power-ledger/seed'
import { commitPowerDB, nextId, powerDB, resetPowerDB } from '@/data/power-ledger/store'
import type {
  EnergyCell,
  MeterReading,
  PowerMeter,
  RatioChange,
  SaveReadingInput,
  SaveResult,
} from '@/data/power-ledger/types'

function getMeter(meterId: number): PowerMeter {
  const meter = powerDB().meters.find((item) => item.id === meterId)
  if (!meter) throw new Error(`没有找到编号为 ${meterId} 的电能表`)
  return meter
}

export function listMeters(): PowerMeter[] {
  return [...powerDB().meters]
}

export function listChanges(meterId?: number): RatioChange[] {
  const all = powerDB().changes
  return all
    .filter((item) => meterId === undefined || item.meterId === meterId)
    .sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : 1))
}

export function listReadings(meterId?: number, month?: string): MeterReading[] {
  return powerDB()
    .readings.filter(
      (item) =>
        (meterId === undefined || item.meterId === meterId) &&
        (month === undefined || item.month === month),
    )
    .sort((a, b) => (a.month === b.month ? a.meterId - b.meterId : a.month < b.month ? 1 : -1))
}

export function meterLabel(meter: PowerMeter): string {
  return `${meter.itemName}（${meter.code}）`
}

/** 台账矩阵：每块表一行、月份倒排列。 */
export function ledgerMatrix(months: number, endMonth: string, area = '', keyword = '') {
  const db = powerDB()
  const monthCols = Array.from({ length: months }, (_, i) => shiftMonth(endMonth, -(months - 1 - i)))
  const meters = db.meters.filter(
    (meter) =>
      (area === '' || meter.area === area) &&
      (keyword.trim() === '' ||
        meter.itemName.includes(keyword.trim()) ||
        meter.code.includes(keyword.trim())),
  )
  const rows = meters.map((meter) => ({
    meter,
    cells: monthCols.map((month) => buildCell(meter, db.changes, db.readings, month)),
  }))
  return { monthCols, rows }
}

/** 某一月的能耗明细，行按电量降序，异常行排前。 */
export function monthDetails(month: string): Array<{ meter: PowerMeter; cell: EnergyCell }> {
  const db = powerDB()
  return cellsForMonth(db.meters, db.changes, db.readings, month)
    .map((cell) => ({ meter: getMeter(cell.meterId), cell }))
    .sort((a, b) => {
      if (a.cell.abnormal !== b.cell.abnormal) return a.cell.abnormal ? -1 : 1
      return (b.cell.energy ?? -1) - (a.cell.energy ?? -1)
    })
}

export function meterTrend(meterId: number, months: number, endMonth: string) {
  const db = powerDB()
  return seriesForMeter(getMeter(meterId), db.changes, db.readings, months, endMonth)
}

export function listAreas(): string[] {
  return [...new Set(powerDB().meters.map((meter) => meter.area))]
}

function latestReadingMonth(meterId: number): string | null {
  const months = powerDB()
    .readings.filter((item) => item.meterId === meterId)
    .map((item) => item.month)
  return months.length ? months.sort().pop()! : null
}

/**
 * 保存月度抄表读数：
 * - 同一块电能表同一个月只能有一条，重复抄录只记一次（冲突时带回已有记录供编辑）；
 * - 每条读数落当月生效倍率的快照，之后改倍率不追溯历史；
 * - 保存后即时重算该表受影响的系统判定。
 */
export function saveReading(input: SaveReadingInput): SaveResult {
  const db = powerDB()
  const meter = getMeter(input.meterId)
  const conflict = db.readings.find(
    (item) => item.meterId === input.meterId && item.month === input.month && item.id !== input.id,
  )
  if (conflict) {
    return {
      ok: false,
      existingId: conflict.id,
      message: `${meterLabel(meter)}在 ${input.month} 已有抄录（表底 ${
        conflict.stopped ? '检修停抄' : conflict.reading ?? '—'
      }，抄表人 ${conflict.reader}），同一块表同一个月只记一次，可直接修改原记录`,
    }
  }
  if (!input.stopped && input.reading === null) {
    return { ok: false, message: '请填写当月表底；检修不抄表请改为登记停抄' }
  }
  if (input.reader.trim() === '') {
    return { ok: false, message: '请填写抄表人' }
  }

  const ratio = ratioAt(meter, db.changes, input.month)
  const now = new Date()
  const stamp = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')} ${`${now.getHours()}`.padStart(2, '0')}:${`${now.getMinutes()}`.padStart(2, '0')}`

  let savedId = input.id ?? 0
  commitPowerDB((draft) => {
    const existing = input.id ? draft.readings.find((item) => item.id === input.id) : undefined
    if (existing) {
      existing.reading = input.stopped ? null : input.reading
      existing.ratioSnapshot = ratio
      existing.stopped = input.stopped
      existing.stopReason = input.stopReason
      existing.abnormal = input.abnormal
      existing.abnormalReason = input.abnormalReason
      existing.reader = input.reader
      savedId = existing.id
    } else {
      const created: MeterReading = {
        id: nextId(),
        meterId: input.meterId,
        month: input.month,
        reading: input.stopped ? null : input.reading,
        ratioSnapshot: ratio,
        stopped: input.stopped,
        stopReason: input.stopReason,
        abnormal: input.abnormal,
        abnormalReason: input.abnormalReason,
        autoAbnormal: false,
        autoReasons: [],
        reader: input.reader,
        readAt: stamp,
      }
      draft.readings.push(created)
      savedId = created.id
    }
  })
  recalcMeter(input.meterId)
  return { ok: true, message: `已保存 ${meterLabel(meter)} ${input.month} 的读数（按当月倍率 ${ratio} 计）` }
}

/** 删除一条抄录（重复误录时使用）；删除后重算受影响月份。 */
export function deleteReading(id: number): SaveResult {
  const target = powerDB().readings.find((item) => item.id === id)
  if (!target) return { ok: false, message: '没有找到这条抄录' }
  commitPowerDB((draft) => {
    draft.readings = draft.readings.filter((item) => item.id !== id)
  })
  recalcMeter(target.meterId)
  return { ok: true, message: '抄录已删除，后续月份已重算' }
}

/** 人工标记/取消能耗异常，与系统判定互不覆盖。 */
export function setManualAbnormal(id: number, abnormal: boolean, reason: string): SaveResult {
  const target = powerDB().readings.find((item) => item.id === id)
  if (!target) return { ok: false, message: '没有找到这条抄录' }
  if (abnormal && reason.trim() === '') return { ok: false, message: '请填写异常说明' }
  commitPowerDB((draft) => {
    const row = draft.readings.find((item) => item.id === id)!
    row.abnormal = abnormal
    row.abnormalReason = abnormal ? reason.trim() : ''
  })
  return { ok: true, message: abnormal ? '已标记为能耗异常' : '已取消人工异常标记' }
}

/**
 * 登记倍率变更：生效月份必须晚于该表最后一条已抄录月份，
 * 即倍率只改今后，历史读数按当时倍率快照保留，不跟着改。
 */
export function addRatioChange(meterId: number, effectiveMonth: string, ratio: number, reason: string): SaveResult {
  const meter = getMeter(meterId)
  if (!(ratio > 0)) return { ok: false, message: '倍率必须是大于 0 的数' }
  if (reason.trim() === '') return { ok: false, message: '请填写倍率变更原因（互感器更换/核定等）' }
  const latest = latestReadingMonth(meterId)
  if (latest && effectiveMonth <= latest) {
    return {
      ok: false,
      message: `${meterLabel(meter)}已抄到 ${latest}，倍率只能从之后的月份生效；${latest} 及以前的历史读数按当时倍率保留，不追溯修改`,
    }
  }
  const dup = powerDB().changes.some(
    (item) => item.meterId === meterId && item.effectiveMonth === effectiveMonth,
  )
  if (dup) return { ok: false, message: `该表在 ${effectiveMonth} 已登记过一次倍率变更` }

  const now = new Date()
  const stamp = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`
  commitPowerDB((draft) => {
    draft.changes.push({
      id: nextId(),
      meterId,
      effectiveMonth,
      ratio,
      reason: reason.trim(),
      changedAt: stamp,
    })
  })
  return { ok: true, message: `已登记：新倍率 ${ratio} 自 ${effectiveMonth} 起生效，历史读数不变` }
}

export function addMeter(input: { code: string; itemName: string; area: string; kind: 'total' | 'sub'; baseRatio: number }): SaveResult {
  if (input.code.trim() === '' || input.itemName.trim() === '' || input.area.trim() === '') {
    return { ok: false, message: '表号、分项名称、所在区域都要填写' }
  }
  if (!(input.baseRatio > 0)) return { ok: false, message: '初始倍率必须大于 0' }
  const db = powerDB()
  if (db.meters.some((meter) => meter.code === input.code.trim())) {
    return { ok: false, message: `电能表编号 ${input.code} 已存在` }
  }
  commitPowerDB((draft) => {
    draft.meters.push({
      id: nextId(),
      code: input.code.trim(),
      itemName: input.itemName.trim(),
      area: input.area.trim(),
      kind: input.kind,
      baseRatio: input.baseRatio,
      status: '在用',
    })
  })
  return { ok: true, message: `已挂表：${input.itemName.trim()}（${input.code.trim()}）` }
}

/** 只重算一块表：系统判定整体覆盖，人工标记保留。 */
function recalcMeter(meterId: number): void {
  const db = powerDB()
  const meter = db.meters.find((item) => item.id === meterId)
  if (!meter) return
  const months = [
    ...new Set(db.readings.filter((item) => item.meterId === meterId).map((item) => item.month)),
  ].sort()
  commitPowerDB((draft) => {
    for (const month of months) {
      const cell = buildCell(meter, db.changes, db.readings, month)
      const row = draft.readings.find((item) => item.meterId === meterId && item.month === month)
      if (!row) continue
      row.autoAbnormal = cell.autoAbnormal
      row.autoReasons = cell.reasons.filter((reason) => reason !== row.abnormalReason)
    }
  })
}

export type RecalcReport = {
  autoAbnormal: number
  manualAbnormal: number
  stopped: number
  missingLatest: number
}

/** 分项重算：逐表逐月重算电量与系统判定，结果落到读数上并反映到能耗明细。 */
export function recalcAll(month: string): RecalcReport {
  const db = powerDB()
  commitPowerDB((draft) => {
    for (const meter of draft.meters) {
      const months = [
        ...new Set(
          draft.readings.filter((item) => item.meterId === meter.id).map((item) => item.month),
        ),
      ].sort()
      for (const m of months) {
        const cell = buildCell(meter, db.changes, db.readings, m)
        const row = draft.readings.find((item) => item.meterId === meter.id && item.month === m)
        if (!row) continue
        row.autoAbnormal = cell.autoAbnormal
        row.autoReasons = cell.reasons.filter((reason) => reason !== row.abnormalReason)
      }
    }
  })
  const cells = cellsForMonth(db.meters, db.changes, db.readings, month)
  return {
    autoAbnormal: db.readings.filter((r) => r.autoAbnormal).length,
    manualAbnormal: db.readings.filter((r) => r.abnormal).length,
    stopped: cells.filter((c) => c.stopped).length,
    missingLatest: cells.filter((c) => c.missing).length,
  }
}

export function resetLedger(): void {
  resetPowerDB()
}

export { buildSeed }
