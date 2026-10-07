import { reactive } from 'vue'

import { buildSeed } from './seed'
import type { PowerLedgerDB } from './types'

// 厂用电台账单独存一份 localStorage，不挤占通用模块的 entries 键。
const STORAGE_KEY = 'waste-to-energy-plant:power-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function load(): PowerLedgerDB {
  const fallback = buildSeed()
  if (typeof window === 'undefined' || !window.localStorage) return fallback
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PowerLedgerDB>
    return {
      meters: parsed.meters ?? fallback.meters,
      changes: parsed.changes ?? fallback.changes,
      readings: parsed.readings ?? fallback.readings,
      seq: parsed.seq ?? fallback.seq,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

const db = reactive<PowerLedgerDB>(load())

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  }
}

export function powerDB(): PowerLedgerDB {
  return db
}

export function commitPowerDB(mutator: (draft: PowerLedgerDB) => void): void {
  mutator(db)
  persist()
}

export function resetPowerDB(): PowerLedgerDB {
  const seed = buildSeed()
  db.meters = clone(seed.meters)
  db.changes = clone(seed.changes)
  db.readings = clone(seed.readings)
  db.seq = seed.seq
  persist()
  return db
}

export function nextId(): number {
  db.seq += 1
  return db.seq
}
