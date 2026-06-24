import type { Task } from '../types/task'

export interface IStorage {
  load(): Promise<Task[]>
  save(tasks: Task[]): Promise<void>
  export(tasks: Task[]): void
  import(json: string): Task[]
  exportCSV(tasks: Task[]): void
  importCSV(csv: string): Task[]
}
