export interface Task {
  id: string
  parentId: string | null
  name: string
  category?: string
  start: string   // "YYYY-MM-DD"
  end: string     // "YYYY-MM-DD"
  progress: number // 0〜100
  color: string
  order: number
  url?: string  // ハイパーリンク（任意）
}

export interface AppData {
  version: number
  updatedAt: string
  tasks: Task[]
}

export const COLOR_OPTIONS = [
  { value: 'purple', label: '紫', hex: '#a855f7' },
  { value: 'blue',   label: '青', hex: '#3b82f6' },
  { value: 'green',  label: '緑', hex: '#22c55e' },
  { value: 'orange', label: '橙', hex: '#f97316' },
  { value: 'red',    label: '赤', hex: '#ef4444' },
  { value: 'gray',   label: '灰', hex: '#6b7280' },
] as const

export function colorToHex(color: string): string {
  return COLOR_OPTIONS.find(c => c.value === color)?.hex ?? '#6b7280'
}
