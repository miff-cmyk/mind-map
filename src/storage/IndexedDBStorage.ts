import { openDB, type IDBPDatabase } from 'idb'
import { v4 as uuidv4 } from 'uuid'
import type { Task, AppData } from '../types/task'
import type { IStorage } from './IStorage'

const DB_NAME = 'task-app'
const DB_VERSION = 1
const STORE_NAME = 'tasks'

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    },
  })
}

export const IndexedDBStorage: IStorage = {
  async load(): Promise<Task[]> {
    const db = await getDB()
    return db.getAll(STORE_NAME)
  },

  async save(tasks: Task[]): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    await tx.store.clear()
    await Promise.all(tasks.map(t => tx.store.put(t)))
    await tx.done
  },

  export(tasks: Task[]): void {
    const data: AppData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      tasks,
    }
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tasks-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  },

  import(json: string): Task[] {
    const data = JSON.parse(json) as AppData
    if (!data.version || !Array.isArray(data.tasks)) {
      throw new Error('無効なJSONファイルです。tasks配列が見つかりません。')
    }
    return data.tasks
  },

  exportCSV(tasks: Task[]): void {
    const header = 'id,parentId,assignee,category,priority,name,start,end,progress,color,order,url,comment'
    const rows = tasks.map(t =>
      [t.id, t.parentId ?? '', t.assignee ?? '', t.category ?? '', t.priority ?? '', t.name, t.start, t.end,
       String(t.progress), t.color, String(t.order), t.url ?? '', t.comment ?? '']
        .map(csvEscape).join(',')
    )
    // BOM付きUTF-8 → Excelで文字化けしない
    const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')],
      { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  },

  importCSV(csv: string): Task[] {
    const rows = parseCsv(csv)
    if (rows.length < 2) throw new Error('CSVにデータ行がありません。')
    const header = rows[0].map(h => h.trim())
    const idx = (name: string) => {
      const i = header.indexOf(name)
      if (i === -1) throw new Error(`CSVに "${name}" 列が見つかりません。`)
      return i
    }
    const iId = idx('id'), iParent = idx('parentId'), iName = idx('name')
    const iStart = idx('start'), iEnd = idx('end'), iProgress = idx('progress')
    const iColor = idx('color'), iOrder = idx('order')
    const iUrl      = header.indexOf('url')       // 省略可
    const iCategory = header.indexOf('category')  // 省略可
    const iComment  = header.indexOf('comment')   // 省略可
    const iAssignee  = header.indexOf('assignee')  // 省略可
    const iPriority  = header.indexOf('priority')  // 省略可

    const dataRows = rows.slice(1).filter(r => r.some(f => f !== ''))

    // id が空 or 重複しうる値でも安全に扱えるよう、全行に新 UUID を振り
    // 元の id → 新 UUID のマップで parentId 参照を解決する
    const idMap = new Map<string, string>()
    dataRows.forEach(r => {
      const orig = r[iId]?.trim()
      const newId = uuidv4()
      if (orig) idMap.set(orig, newId)
      r[iId] = newId   // 行を直接書き換えておく
    })

    return dataRows.map(r => {
      const origParent = r[iParent]?.trim()
      return {
        id:       r[iId],
        parentId: origParent ? (idMap.get(origParent) ?? null) : null,
        name:     r[iName] || '新しいタスク',
        category: (iCategory >= 0 && r[iCategory]) ? r[iCategory] : undefined,
        start:    normalizeDate(r[iStart]),
        end:      normalizeDate(r[iEnd]),
        progress: Math.max(0, Math.min(100, Number(r[iProgress]) || 0)),
        color:    r[iColor] || 'blue',
        order:    Number(r[iOrder]) || 0,
        assignee:  (iAssignee >= 0 && r[iAssignee]) ? r[iAssignee] : undefined,
        priority:  (iPriority >= 0 && ['high','medium','low'].includes(r[iPriority])) ? r[iPriority] as 'high'|'medium'|'low' : undefined,
        url:      (iUrl >= 0 && r[iUrl]) ? r[iUrl] : undefined,
        comment:  (iComment >= 0 && r[iComment]) ? r[iComment] : undefined,
      }
    })
  },
}

/** yyyy/m/d や yyyy-m-d など各種形式を yyyy-mm-dd に統一 */
function normalizeDate(s: string): string {
  const parts = s.trim().split(/[-/]/).map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`日付の形式が無効です: "${s}"（例: 2026-06-27 または 2026/6/27）`)
  }
  const [y, m, d] = parts
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

function parseCsv(csv: string): string[][] {
  if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuote = false
  let i = 0
  while (i < csv.length) {
    const ch = csv[i]
    if (inQuote) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i += 2 }
      else if (ch === '"') { inQuote = false; i++ }
      else { field += ch; i++ }
    } else {
      if (ch === '"') { inQuote = true; i++ }
      else if (ch === ',') { row.push(field); field = ''; i++ }
      else if (ch === '\r' && csv[i + 1] === '\n') {
        row.push(field); rows.push(row); row = []; field = ''; i += 2
      } else if (ch === '\n' || ch === '\r') {
        row.push(field); rows.push(row); row = []; field = ''; i++
      } else { field += ch; i++ }
    }
  }
  if (row.length > 0 || field) { row.push(field); if (row.some(f => f)) rows.push(row) }
  return rows
}
