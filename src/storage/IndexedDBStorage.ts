import { openDB, type IDBPDatabase } from 'idb'
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
}
