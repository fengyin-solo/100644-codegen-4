import type { EnergyCell, MeterReading, PowerMeter, RatioChange } from './types'

/** 环比上涨超过 50% 判定为能耗突增；停抄复抄等跨期月份不参与自动判定。 */
export const SURGE_THRESHOLD = 0.5

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  const y = date.getUTCFullYear()
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  return `${y}-${m}`
}

/** 取某月份生效的倍率：取生效月份 <= month 的最近一次变更，没有变更则用建档倍率。 */
export function ratioAt(meter: PowerMeter, changes: RatioChange[], month: string): number {
  const hits = changes
    .filter((item) => item.meterId === meter.id && item.effectiveMonth <= month)
    .sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : 1))
  return hits.length ? hits[hits.length - 1].ratio : meter.baseRatio
}

function readingsByMeter(readings: MeterReading[], meterId: number): MeterReading[] {
  return readings
    .filter((item) => item.meterId === meterId)
    .sort((a, b) => (a.month < b.month ? -1 : 1))
}

/** 找到 month 之前（不含本月）最近一条可参与差分计算的有效读数：有表底、非停抄。 */
function previousValid(series: MeterReading[], month: string): MeterReading | null {
  let prev: MeterReading | null = null
  for (const item of series) {
    if (item.month >= month) break
    if (!item.stopped && item.reading !== null) prev = item
  }
  return prev
}

/** 两条有效读数之间是否存在登记过的停抄月或断抄月（跨期电量不再参与环比自动判异）。 */
function gapBetween(series: MeterReading[], earlier: string, later: string): { cross: boolean; label: string } {
  const stops: string[] = []
  let missing = 0
  let cursor = shiftMonth(earlier, 1)
  while (cursor < later) {
    const hit = series.find((item) => item.month === cursor)
    if (!hit) missing += 1
    else if (hit.stopped) stops.push(cursor)
    cursor = shiftMonth(cursor, 1)
  }
  if (!stops.length && missing === 0) return { cross: false, label: '' }
  const parts: string[] = []
  if (stops.length) parts.push(`跨停抄月 ${stops.join('、')}`)
  if (missing) parts.push(`跨未抄月 ${missing} 个`)
  return { cross: true, label: parts.join('，') }
}

/** 计算一块表在 month 的电量与判定结果。 */
export function buildCell(
  meter: PowerMeter,
  changes: RatioChange[],
  readings: MeterReading[],
  month: string,
): EnergyCell {
  const series = readingsByMeter(readings, meter.id)
  const current = series.find((item) => item.month === month)

  const base: EnergyCell = {
    meterId: meter.id,
    month,
    reading: null,
    ratioSnapshot: null,
    energy: null,
    mom: null,
    stopped: false,
    crossGap: false,
    gapLabel: '',
    missing: false,
    abnormal: false,
    autoAbnormal: false,
    reasons: [],
    manual: false,
  }

  if (!current) {
    return { ...base, missing: true }
  }

  base.reading = current.reading
  base.ratioSnapshot = current.ratioSnapshot
  base.stopped = current.stopped
  base.manual = current.abnormal
  if (current.abnormal) {
    base.abnormal = true
    base.reasons.push(current.abnormalReason || '人工标记异常')
  }
  if (current.stopped) {
    base.reasons.unshift(`检修停抄：${current.stopReason || '原因未填写'}`)
    return base
  }
  if (current.reading === null) {
    base.reasons.unshift('停抄记录无表底')
    return base
  }

  const prev = previousValid(series, month)
  if (!prev || prev.reading === null) {
    base.reasons.push('无上期有效读数，本月不计电量')
    return base
  }

  const diff = current.reading - prev.reading
  const energy = diff * current.ratioSnapshot
  base.energy = energy

  if (diff < 0) {
    base.autoAbnormal = true
    base.abnormal = true
    base.reasons.unshift('表底较上期倒退，疑似抄录错误或换表未登记')
  } else {
    const prevEnergy = buildEnergyAt(series, prev)
    if (prevEnergy !== null && prevEnergy > 0) {
      const mom = (energy - prevEnergy) / prevEnergy
      base.mom = mom
      const gap = gapBetween(series, prev.month, month)
      base.crossGap = gap.cross
      base.gapLabel = gap.label
      if (!gap.cross && mom >= SURGE_THRESHOLD) {
        base.autoAbnormal = true
        base.abnormal = true
        base.reasons.unshift(`电量环比上涨 ${(mom * 100).toFixed(1)}%，超过 ${SURGE_THRESHOLD * 100}% 阈值`)
      }
    }
  }
  return base
}

/** 用上一条有效读数的倍率快照计算该月电量（环比基数用）。 */
function buildEnergyAt(series: MeterReading[], target: MeterReading): number | null {
  if (target.reading === null) return null
  const prev = previousValid(series, target.month)
  if (!prev || prev.reading === null) return null
  return (target.reading - prev.reading) * target.ratioSnapshot
}

/** 一块表最近若干个月（含停抄/断档）的走势，按月份升序。 */
export function seriesForMeter(
  meter: PowerMeter,
  changes: RatioChange[],
  readings: MeterReading[],
  months: number,
  endMonth: string,
): EnergyCell[] {
  const cells: EnergyCell[] = []
  for (let i = months - 1; i >= 0; i -= 1) {
    cells.push(buildCell(meter, changes, readings, shiftMonth(endMonth, -i)))
  }
  return cells
}

/** 一个月内全部表的计算结果，顺序与 meters 一致。 */
export function cellsForMonth(
  meters: PowerMeter[],
  changes: RatioChange[],
  readings: MeterReading[],
  month: string,
): EnergyCell[] {
  return meters.map((meter) => buildCell(meter, changes, readings, month))
}

export function formatNumber(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return '—'
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatEnergy(value: number | null): string {
  return value === null ? '—' : `${formatNumber(value)} kWh`
}

export function formatMom(value: number | null): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
}
