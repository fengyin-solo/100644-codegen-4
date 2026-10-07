/** 厂用电分项能耗台账的领域类型：独立于通用 EntryRow，倍率留痕、停抄等规则都在这一层表达。 */

/** 电能表：每块表挂一个分项计量名称、所在区域与（当前）倍率。 */
export type PowerMeter = {
  id: number
  /** 电能表编号，如 EM-012 */
  code: string
  /** 分项计量名称，如「1#引风机用电」 */
  itemName: string
  /** 所在区域，如「焚烧车间」 */
  area: string
  /** 总表 / 分项表 */
  kind: 'total' | 'sub'
  /** 初始（建档）综合倍率，历史月份按各读数自带的倍率快照保留 */
  baseRatio: number
  status: '在用' | '停用'
}

/** 倍率变更记录：改倍率只对未抄录的月份生效，历史读数不追溯。 */
export type RatioChange = {
  id: number
  meterId: number
  /** 生效月份 YYYY-MM（含本月） */
  effectiveMonth: string
  ratio: number
  reason: string
  changedAt: string
}

/** 月度抄表读数：同一块电能表同一个月只能有一条。 */
export type MeterReading = {
  id: number
  meterId: number
  /** 抄表月份 YYYY-MM */
  month: string
  /** 表底累计读数（表显值）；检修停抄时为 null */
  reading: number | null
  /** 抄录时该月生效倍率的快照，之后倍率再改也不跟着变 */
  ratioSnapshot: number
  /** 检修停抄：当月不抄表、不计电量 */
  stopped: boolean
  stopReason: string
  /** 人工标记的能耗异常 */
  abnormal: boolean
  abnormalReason: string
  /** 分项重算写入的系统判定，重算时整体覆盖 */
  autoAbnormal: boolean
  autoReasons: string[]
  reader: string
  readAt: string
}

export type PowerLedgerDB = {
  meters: PowerMeter[]
  changes: RatioChange[]
  readings: MeterReading[]
  seq: number
}

/** 台账矩阵 / 走势里每块表每个月的计算结果。 */
export type EnergyCell = {
  meterId: number
  month: string
  reading: number | null
  ratioSnapshot: number | null
  /** 本月电量（kWh），无上期或停抄时为 null */
  energy: number | null
  /** 环比（%），无法比较时为 null */
  mom: number | null
  stopped: boolean
  /** 与上一条有效读数之间隔着停抄月或未抄月 */
  crossGap: boolean
  gapLabel: string
  /** 该月完全没有读数记录（区别于登记过的停抄） */
  missing: boolean
  abnormal: boolean
  /** 系统规则判定（突增/倒退），与人工标记分开 */
  autoAbnormal: boolean
  reasons: string[]
  manual: boolean
}

export type SaveReadingInput = {
  id?: number
  meterId: number
  month: string
  reading: number | null
  reader: string
  stopped: boolean
  stopReason: string
  abnormal: boolean
  abnormalReason: string
}

export type SaveResult = {
  ok: boolean
  message: string
  /** 表-月唯一约束冲突时带回已存在的读数 id，页面可直接转去编辑 */
  existingId?: number
}
