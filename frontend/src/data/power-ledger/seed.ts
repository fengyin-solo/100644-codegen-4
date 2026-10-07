import { buildCell, ratioAt } from './engine'
import type { MeterReading, PowerLedgerDB, PowerMeter, RatioChange } from './types'

// 示例数据：覆盖倍率调整、检修停抄复抄、环比突增、人工标记异常四类规则场景。
const METERS: PowerMeter[] = [
  { id: 1, code: 'EM-000', itemName: '厂用电总表', area: '主厂房配电室', kind: 'total', baseRatio: 1000, status: '在用' },
  { id: 2, code: 'EM-010', itemName: '1#一次风机用电', area: '焚烧车间', kind: 'sub', baseRatio: 100, status: '在用' },
  { id: 3, code: 'EM-011', itemName: '1#二次风机用电', area: '焚烧车间', kind: 'sub', baseRatio: 100, status: '在用' },
  { id: 4, code: 'EM-012', itemName: '1#引风机用电', area: '焚烧车间', kind: 'sub', baseRatio: 80, status: '在用' },
  { id: 5, code: 'EM-013', itemName: '1#给水泵用电', area: '汽机车间', kind: 'sub', baseRatio: 60, status: '在用' },
  { id: 6, code: 'EM-014', itemName: '2#循环水泵用电', area: '汽机车间', kind: 'sub', baseRatio: 100, status: '在用' },
  { id: 7, code: 'EM-015', itemName: '2#锅炉给水泵用电', area: '汽机车间', kind: 'sub', baseRatio: 50, status: '在用' },
  { id: 8, code: 'EM-020', itemName: '抓斗起重机用电', area: '垃圾池', kind: 'sub', baseRatio: 150, status: '在用' },
  { id: 9, code: 'EM-030', itemName: '渗滤液站用电', area: '渗滤液处理站', kind: 'sub', baseRatio: 200, status: '在用' },
  { id: 10, code: 'EM-031', itemName: '空压机站用电', area: '公用工程', kind: 'sub', baseRatio: 100, status: '在用' },
]

const CHANGES: Array<Omit<RatioChange, 'id' | 'changedAt'>> = [
  { meterId: 4, effectiveMonth: '2026-04', ratio: 100, reason: '1#引风机电流互感器更换，综合倍率由 80 调整为 100' },
  { meterId: 6, effectiveMonth: '2026-07', ratio: 120, reason: '2#循环水泵加装变频器后互感器倍率核定为 120' },
]

// 表底计划：2025-12 为上期底数，之后每月表显累计读数；null 表示检修停抄。
const RAW_PLANS: Record<number, Array<[string, number | null, string?]>> = {
  1: [['2025-12', 1200], ['2026-01', 1256], ['2026-02', 1311], ['2026-03', 1368], ['2026-04', 1423], ['2026-05', 1480], ['2026-06', 1538], ['2026-07', 1596], ['2026-08', 1656], ['2026-09', 1714]],
  2: [['2025-12', 800], ['2026-01', 890], ['2026-02', 982], ['2026-03', 1075], ['2026-04', 1168], ['2026-05', 1260], ['2026-06', 1355], ['2026-07', 1448], ['2026-08', null, '1#一次风机大修'], ['2026-09', 1630]],
  3: [['2025-12', 600], ['2026-01', 665], ['2026-02', 730], ['2026-03', 796], ['2026-04', 860], ['2026-05', 926], ['2026-06', 992], ['2026-07', 1056], ['2026-08', 1122], ['2026-09', 1186]],
  4: [['2025-12', 500], ['2026-01', 585], ['2026-02', 672], ['2026-03', 760], ['2026-04', 832], ['2026-05', 918], ['2026-06', 1005], ['2026-07', 1090], ['2026-08', 1178], ['2026-09', 1262]],
  5: [['2025-12', 400], ['2026-01', 480], ['2026-02', 562], ['2026-03', 640], ['2026-04', 722], ['2026-05', 800], ['2026-06', 882], ['2026-07', 960], ['2026-08', 1042], ['2026-09', 1120]],
  6: [['2025-12', 700], ['2026-01', 760], ['2026-02', 822], ['2026-03', 880], ['2026-04', 942], ['2026-05', 1000], ['2026-06', 1062], ['2026-07', 1108], ['2026-08', 1164], ['2026-09', 1220]],
  7: [['2025-12', 900], ['2026-01', 955], ['2026-02', 1010], ['2026-03', 1068], ['2026-04', 1122], ['2026-05', 1200], ['2026-06', 1178], ['2026-07', 1235], ['2026-08', 1290], ['2026-09', 1348]],
  8: [['2025-12', 300], ['2026-01', 352], ['2026-02', 405], ['2026-03', 460], ['2026-04', 512], ['2026-05', 568], ['2026-06', 620], ['2026-07', 675], ['2026-08', 728], ['2026-09', 782]],
  9: [['2025-12', 200], ['2026-01', 238], ['2026-02', 275], ['2026-03', 312], ['2026-04', 350], ['2026-05', 386], ['2026-06', 425], ['2026-07', 462], ['2026-08', 500], ['2026-09', 538]],
  10: [['2025-12', 100], ['2026-01', 130], ['2026-02', 162], ['2026-03', 190], ['2026-04', 222], ['2026-05', 250], ['2026-06', 282], ['2026-07', 308], ['2026-08', 360], ['2026-09', 448]],
}

const READERS = ['王建国', '李秀英', '张志强']

function buildReadings(changes: RatioChange[]): MeterReading[] {
  const list: MeterReading[] = []
  let id = 1
  for (const meter of METERS) {
    const plan = RAW_PLANS[meter.id] ?? []
    plan.forEach(([month, raw, stopReason], index) => {
      const stopped = raw === null
      list.push({
        id: id++,
        meterId: meter.id,
        month,
        reading: raw,
        ratioSnapshot: ratioAt(meter, changes, month),
        stopped,
        stopReason: stopped ? stopReason ?? '设备检修停抄' : '',
        abnormal: meter.id === 7 && month === '2026-05',
        abnormalReason: meter.id === 7 && month === '2026-05' ? '现场核对泵运行电流偏大，待排查管路泄漏' : '',
        autoAbnormal: false,
        autoReasons: [],
        reader: READERS[index % READERS.length],
        readAt: month === '2025-12' ? `${month}-31 09:00` : `${month}-28 09:00`,
      })
    })
  }
  return list
}

export function buildSeed(): PowerLedgerDB {
  const changes: RatioChange[] = CHANGES.map((item, index) => ({
    ...item,
    id: index + 1,
    changedAt: item.effectiveMonth === '2026-04' ? '2026-03-25 14:30' : '2026-06-28 10:15',
  }))
  const readings = buildReadings(changes)
  // 首次播种就把系统判定（突增/倒退/跨停抄）算好，页面首次打开即可看到高亮。
  for (const meter of METERS) {
    const months = [...new Set(readings.filter((r) => r.meterId === meter.id).map((r) => r.month))].sort()
    for (const month of months) {
      const cell = buildCell(meter, changes, readings, month)
      const row = readings.find((r) => r.meterId === meter.id && r.month === month)
      if (row) {
        row.autoAbnormal = cell.autoAbnormal
        row.autoReasons = cell.reasons.filter((reason) => reason !== row.abnormalReason)
      }
    }
  }
  return {
    meters: METERS,
    changes,
    readings,
    seq: 1000,
  }
}

export function latestSeedMonth(db: PowerLedgerDB): string {
  return db.readings.reduce((latest, item) => (item.month > latest ? item.month : latest), '2025-12')
}
