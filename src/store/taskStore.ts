import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Task } from '../types/task'
import { IndexedDBStorage } from '../storage/IndexedDBStorage'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function twoWeeksLater(): string {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return d.toISOString().slice(0, 10)
}

function getAllDescendantIds(tasks: Task[], id: string): string[] {
  const children = tasks.filter(t => t.parentId === id)
  return children.flatMap(c => [c.id, ...getAllDescendantIds(tasks, c.id)])
}

function nextOrder(tasks: Task[], parentId: string | null): number {
  const siblings = tasks.filter(t => t.parentId === parentId)
  return siblings.length > 0 ? Math.max(...siblings.map(t => t.order)) + 1 : 0
}

interface TaskStore {
  tasks: Task[]
  selectedTaskId: string | null
  isLoaded: boolean
  collapsedIds: string[]        // マインドマップの折りたたみ（IndexedDBには保存しない）
  ganttCollapsedIds: string[]   // ガントチャートの折りたたみ（IndexedDBには保存しない）

  loadFromStorage(): Promise<void>
  selectTask(id: string | null): void
  addTask(parentId: string | null): void
  updateTask(id: string, updates: Partial<Omit<Task, 'id'>>): void
  deleteTask(id: string): void
  exportData(): void
  importData(json: string): void
  exportCSV(): void
  importCSV(csv: string): void
  toggleCollapse(id: string): void
  toggleGanttCollapse(id: string): void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoaded: false,
  collapsedIds: [],
  ganttCollapsedIds: [],

  async loadFromStorage() {
    const tasks = await IndexedDBStorage.load()
    set({ tasks, isLoaded: true })
  },

  selectTask(id) {
    set({ selectedTaskId: id })
  },

  addTask(parentId) {
    const { tasks, collapsedIds } = get()
    const newTask: Task = {
      id: uuidv4(),
      parentId,
      name: '新しいタスク',
      start: today(),
      end: twoWeeksLater(),
      progress: 0,
      color: 'blue',
      order: nextOrder(tasks, parentId),
    }
    const updated = [...tasks, newTask]
    // 親が折りたたまれていれば自動展開する
    const newCollapsedIds = parentId
      ? collapsedIds.filter(id => id !== parentId)
      : collapsedIds
    set({ tasks: updated, selectedTaskId: newTask.id, collapsedIds: newCollapsedIds })
    IndexedDBStorage.save(updated)
  },

  updateTask(id, updates) {
    const updated = get().tasks.map(t => t.id === id ? { ...t, ...updates } : t)
    set({ tasks: updated })
    IndexedDBStorage.save(updated)
  },

  deleteTask(id) {
    const { tasks, selectedTaskId, collapsedIds } = get()
    const idsToDelete = new Set([id, ...getAllDescendantIds(tasks, id)])
    const updated = tasks.filter(t => !idsToDelete.has(t.id))
    set({
      tasks: updated,
      selectedTaskId: selectedTaskId && idsToDelete.has(selectedTaskId) ? null : selectedTaskId,
      collapsedIds: collapsedIds.filter(cid => !idsToDelete.has(cid)),
    })
    IndexedDBStorage.save(updated)
  },

  exportData() {
    IndexedDBStorage.export(get().tasks)
  },

  importData(json) {
    try {
      const tasks = IndexedDBStorage.import(json)
      set({ tasks, selectedTaskId: null, collapsedIds: [] })
      IndexedDBStorage.save(tasks)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'インポートに失敗しました')
    }
  },

  exportCSV() {
    IndexedDBStorage.exportCSV(get().tasks)
  },

  importCSV(csv) {
    try {
      const tasks = IndexedDBStorage.importCSV(csv)
      set({ tasks, selectedTaskId: null, collapsedIds: [] })
      IndexedDBStorage.save(tasks)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'CSVインポートに失敗しました')
    }
  },

  toggleCollapse(id) {
    const { collapsedIds } = get()
    set({
      collapsedIds: collapsedIds.includes(id)
        ? collapsedIds.filter(cid => cid !== id)
        : [...collapsedIds, id],
    })
  },

  toggleGanttCollapse(id) {
    const { ganttCollapsedIds } = get()
    set({
      ganttCollapsedIds: ganttCollapsedIds.includes(id)
        ? ganttCollapsedIds.filter(cid => cid !== id)
        : [...ganttCollapsedIds, id],
    })
  },
}))
