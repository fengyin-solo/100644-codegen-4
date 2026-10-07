// 厂用电分项能耗台账：领域数据层。
// 与通用模块不同，台账有自己的结构（电能表 + 月度读数），
// 持久化沿用 localStorage 的模式，但用独立的 key，互不干扰。

export type MeterRatioLog = {
  month: string // 变更生效月份 YYYY-MM
  ratio: number
}

export type EnergyMeter = {
  id: number
  code: string // 表计编号
  item: string // 分项计量名称
  area: string // 所在区域
  ratio: number // 当前倍率（只影响之后抄录的读数）
  ratioLog: MeterRatioLog[] // 倍率变更记录，便于追溯
}

export type MeterReading = {
  id: number
  meterId: number
  month: string // 抄表月份 YYYY-MM，同一块表同一个月只有一条
  value: number | null // 抄表表码 kWh；停抄时为 null
  ratio: number // 抄录时的倍率快照：倍率后来改了，历史月份仍按当时的算
  status: '已抄' | '停抄'
  note: string // 停抄说明等
}

export type LedgerEntry = {
  meterId: number
  code: string
  item: string
  area: string
  month: string
  prevValue: number | null
  value: number | null
  ratio: number
  energy: number | null // 分项重算后的能耗 kWh
  mom: number | null // 环比 %，相对上一个可算的月份
  status: '已抄' | '停抄' | '缺上月读数'
  note: string
  abnormal: boolean
}

type LedgerState = {
  meters: EnergyMeter[]
  readings: MeterReading[]
}

const STORAGE_KEY = 'waste-to-energy-plant:energy-ledger'

// 环比偏差达到 ±30% 视为能耗异常；倍率当月调整过的不算（跳变有明确原因）。
const ABNORMAL_THRESHOLD = 30

function seedState(): LedgerState {
  const meters: EnergyMeter[] = [
    { id: 1, code: 'EM-001', item: '焚烧炉动力', area: '主厂房', ratio: 100, ratioLog: [{ month: '2026-08', ratio: 100 }] },
    { id: 2, code: 'EM-002', item: '余热锅炉给水', area: '主厂房', ratio: 40, ratioLog: [] },
    { id: 3, code: 'EM-003', item: '烟气净化系统', area: '烟气净化间', ratio: 60, ratioLog: [] },
    { id: 4, code: 'EM-004', item: '渗滤液处理站', area: '渗滤液处理区', ratio: 20, ratioLog: [] },
    { id: 5, code: 'EM-005', item: '厂前区照明', area: '综合楼', ratio: 1, ratioLog: [] },
    { id: 6, code: 'EM-006', item: '飞灰固化车间', area: '固化车间', ratio: 10, ratioLog: [] },
  ]
  // 表码为累计值；ratio 是抄录当月的倍率快照。EM-001 在 2026-08 换了互感器，倍率 80 → 100。
  const raw: Array<[number, string, number | null, number, '已抄' | '停抄', string]> = [
    [1, '2026-03', 12000, 80, '已抄', ''],
    [1, '2026-04', 12950, 80, '已抄', ''],
    [1, '2026-05', 13960, 80, '已抄', ''],
    [1, '2026-06', 15010, 80, '已抄', ''],
    [1, '2026-07', 16020, 80, '已抄', ''],
    [1, '2026-08', 17080, 100, '已抄', '互感器更换，倍率调整为100'],
    [1, '2026-09', 18100, 100, '已抄', ''],
    [2, '2026-03', 30000, 40, '已抄', ''],
    [2, '2026-04', 30800, 40, '已抄', ''],
    [2, '2026-05', 31620, 40, '已抄', ''],
    [2, '2026-06', 32450, 40, '已抄', ''],
    [2, '2026-07', 33200, 40, '已抄', ''],
    [2, '2026-08', 34010, 40, '已抄', ''],
    [2, '2026-09', 34800, 40, '已抄', ''],
    [3, '2026-03', 8000, 60, '已抄', ''],
    [3, '2026-04', 8600, 60, '已抄', ''],
    [3, '2026-05', 9250, 60, '已抄', ''],
    [3, '2026-06', 9930, 60, '已抄', ''],
    [3, '2026-07', 10650, 60, '已抄', ''],
    [3, '2026-08', 11420, 60, '已抄', ''],
    [3, '2026-09', 12420, 60, '已抄', ''],
    [4, '2026-03', 5000, 20, '已抄', ''],
    [4, '2026-04', 5400, 20, '已抄', ''],
    [4, '2026-05', 5810, 20, '已抄', ''],
    [4, '2026-06', 6230, 20, '已抄', ''],
    [4, '2026-07', null, 20, '停抄', '渗滤液站大修，设备停运，本月停抄'],
    [4, '2026-08', 7050, 20, '已抄', ''],
    [4, '2026-09', 7460, 20, '已抄', ''],
    [5, '2026-03', 900, 1, '已抄', ''],
    [5, '2026-04', 1200, 1, '已抄', ''],
    [5, '2026-05', 1500, 1, '已抄', ''],
    [5, '2026-06', 1810, 1, '已抄', ''],
    [5, '2026-07', 2130, 1, '已抄', ''],
    [5, '2026-08', 2440, 1, '已抄', ''],
    [5, '2026-09', 2760, 1, '已抄', ''],
    [6, '2026-03', 2000, 10, '已抄', ''],
    [6, '2026-04', 2600, 10, '已抄', ''],
    [6, '2026-05', 3200, 10, '已抄', ''],
    [6, '2026-06', 3800, 10, '已抄', ''],
    [6, '2026-07', 4400, 10, '已抄', ''],
    [6, '2026-08', 4700, 10, '已抄', ''],
    [6, '2026-09', 5300, 10, '已抄', ''],
  ]
  const readings: MeterReading[] = raw.map(([meterId, month, value, ratio, status, note], index) => ({
    id: index + 1,
    meterId,
    month,
    value,
    ratio,
    status,
    note,
  }))
  return { meters, readings }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readState(): LedgerState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as LedgerState
    if (!Array.isArray(parsed.meters) || !Array.isArray(parsed.readings)) {
      throw new Error('bad shape')
    }
    return parsed
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: LedgerState | null = null

function state(): LedgerState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

function persist(next: LedgerState): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function listMeters(): EnergyMeter[] {
  return clone(state().meters)
}

export function listReadings(): MeterReading[] {
  return clone(state().readings)
}

export function resetLedger(): LedgerState {
  const fresh = seedState()
  persist(fresh)
  return clone(fresh)
}

export function getMeter(meterId: number): EnergyMeter | undefined {
  return state().meters.find((meter) => meter.id === meterId)
}

/** 日历上的上一个月份：2026-01 的上个月是 2025-12。 */
export function prevMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(year, mon - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 台账里出现过的月份，升序。 */
export function ledgerMonths(readings: MeterReading[], limit = 6): string[] {
  const months = [...new Set(readings.map((reading) => reading.month))].sort()
  return months.slice(-limit)
}

export type UpsertReadingInput = {
  meterId: number
  month: string
  value: number | null // 停抄传 null
  note?: string
}

export type UpsertReadingResult =
  | { ok: true; created: boolean; reading: MeterReading; message: string }
  | { ok: false; message: string }

/**
 * 抄录读数：同一块电能表在同一个月只能有一条读数。
 * 重复抄录时覆盖原记录（仍只记一条）；历史读数的倍率快照保持不动，
 * 即使表计倍率后来调整过，历史月份仍按当时的倍率计算。
 */
export function upsertReading(input: UpsertReadingInput): UpsertReadingResult {
  const current = state()
  const meter = current.meters.find((item) => item.id === input.meterId)
  if (!meter) {
    return { ok: false, message: '没有找到这块电能表' }
  }
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    return { ok: false, message: '月份格式应为 YYYY-MM' }
  }
  const suspended = input.value === null
  if (!suspended && (!Number.isFinite(input.value) || (input.value as number) < 0)) {
    return { ok: false, message: '表码应为不小于 0 的数字' }
  }
  const note = (input.note ?? '').trim()
  if (suspended && !note) {
    return { ok: false, message: '停抄需要填写说明（如设备检修）' }
  }
  const readings = [...current.readings]
  const index = readings.findIndex(
    (reading) => reading.meterId === input.meterId && reading.month === input.month,
  )
  if (index >= 0) {
    // 重复抄录：只记一次，覆盖原记录；倍率快照沿用原记录，历史不跟着新倍率走。
    const updated: MeterReading = {
      ...readings[index],
      value: suspended ? null : (input.value as number),
      status: suspended ? '停抄' : '已抄',
      note,
    }
    readings[index] = updated
    persist({ ...current, readings })
    return {
      ok: true,
      created: false,
      reading: clone(updated),
      message: `${meter.code} 在 ${input.month} 已有读数，已覆盖原记录（同表同月只记一条，倍率仍按当时快照）`,
    }
  }
  const reading: MeterReading = {
    id: readings.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    meterId: input.meterId,
    month: input.month,
    value: suspended ? null : (input.value as number),
    ratio: meter.ratio, // 新读数按当前倍率记快照
    status: suspended ? '停抄' : '已抄',
    note,
  }
  persist({ ...current, readings: [...readings, reading] })
  return {
    ok: true,
    created: true,
    reading: clone(reading),
    message: `${meter.code} ${input.month} 读数已登记，倍率按当前 ${meter.ratio} 记入快照`,
  }
}

/**
 * 调整表计倍率：只改当前倍率并追加变更记录，
 * 已抄录的历史读数带着当时的倍率快照，不跟着改。
 */
export function updateMeterRatio(
  meterId: number,
  ratio: number,
  effectiveMonth: string,
): { ok: boolean; message: string } {
  const current = state()
  const meter = current.meters.find((item) => item.id === meterId)
  if (!meter) {
    return { ok: false, message: '没有找到这块电能表' }
  }
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { ok: false, message: '倍率应为大于 0 的数字' }
  }
  if (!/^\d{4}-\d{2}$/.test(effectiveMonth)) {
    return { ok: false, message: '生效月份格式应为 YYYY-MM' }
  }
  if (meter.ratio === ratio) {
    return { ok: false, message: `${meter.code} 当前倍率已是 ${ratio}，无需调整` }
  }
  const meters = current.meters.map((item) =>
    item.id === meterId
      ? { ...item, ratio, ratioLog: [...item.ratioLog, { month: effectiveMonth, ratio }] }
      : item,
  )
  persist({ ...current, meters })
  return {
    ok: true,
    message: `${meter.code} 倍率已调整为 ${ratio}（${effectiveMonth} 起），历史月份读数仍按当时倍率保留`,
  }
}

/** 分项重算：由抄表读数 × 当时的倍率快照，逐表逐月推出能耗明细。 */
export function computeEntries(meters: EnergyMeter[], readings: MeterReading[]): LedgerEntry[] {
  const byKey = new Map(readings.map((reading) => [`${reading.meterId}|${reading.month}`, reading]))
  const entries: LedgerEntry[] = []
  for (const meter of meters) {
    const months = [...new Set(readings.filter((r) => r.meterId === meter.id).map((r) => r.month))].sort()
    // 每个表的历史能耗序列（可算的月份），用于环比与异常判定。
    const history: Array<{ month: string; energy: number; ratio: number }> = []
    for (const month of months) {
      const reading = byKey.get(`${meter.id}|${month}`)
      if (!reading) {
        continue
      }
      const prev = byKey.get(`${meter.id}|${prevMonth(month)}`)
      const base: Omit<LedgerEntry, 'energy' | 'mom' | 'status' | 'abnormal'> = {
        meterId: meter.id,
        code: meter.code,
        item: meter.item,
        area: meter.area,
        month,
        prevValue: prev && prev.status === '已抄' ? prev.value : null,
        value: reading.value,
        ratio: reading.ratio,
        note: reading.note,
      }
      if (reading.status === '停抄') {
        entries.push({ ...base, energy: null, mom: null, status: '停抄', abnormal: false })
        continue
      }
      if (!prev || prev.status !== '已抄' || prev.value === null || reading.value === null) {
        entries.push({ ...base, energy: null, mom: null, status: '缺上月读数', abnormal: false })
        continue
      }
      const energy = (reading.value - prev.value) * reading.ratio
      const last = history[history.length - 1]
      const mom = last && last.energy !== 0 ? ((energy - last.energy) / last.energy) * 100 : null
      // 异常判定：表码倒走必异常；与最近可算月份（最多3个月）均值偏差超阈值也算，
      // 但当月倍率快照与上月不同（倍率刚调整）时不判，跳变有明确原因。
      let abnormal = energy < 0
      if (!abnormal && history.length > 0) {
        const window = history.slice(-3)
        const avg = window.reduce((sum, item) => sum + item.energy, 0) / window.length
        const ratioChanged = prev.ratio !== reading.ratio
        if (avg > 0 && !ratioChanged && Math.abs(energy - avg) / avg >= ABNORMAL_THRESHOLD / 100) {
          abnormal = true
        }
      }
      entries.push({ ...base, energy, mom, status: '已抄', abnormal })
      history.push({ month, energy, ratio: reading.ratio })
    }
  }
  return entries
}

/** 某一块表最近几个月的走势，给详情面板的趋势图用。 */
export function meterTrend(entries: LedgerEntry[], meterId: number, limit = 6): LedgerEntry[] {
  return entries
    .filter((entry) => entry.meterId === meterId)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-limit)
}

/** 停抄记录单独列出来，说明设备检修等原因。 */
export function suspendedReadings(readings: MeterReading[]): MeterReading[] {
  return readings
    .filter((reading) => reading.status === '停抄')
    .sort((a, b) => a.month.localeCompare(b.month))
}
