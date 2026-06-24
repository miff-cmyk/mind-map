import { useMemo, useState } from 'react'
import type { Task as GanttTask } from 'gantt-task-react'
import { useTaskStore } from '../../store/taskStore'

// ─── 列幅の定義 ───────────────────────────────────────────────
export const DRAG_HANDLE_WIDTH   = 20
export const CATEGORY_COL_WIDTH  = 72
export const DATE_COL_WIDTH      = 55
export const DATE_COL_EDIT_WIDTH = 130
export const PROGRESS_COL_WIDTH  = 68
export const LIST_CELL_WIDTH     = 420

const INDENT_SIZE  = 16
const BASE_PADDING = 4

// ─── ユーティリティ ───────────────────────────────────────────
function getDepth(taskId: string, tasks: GanttTask[]): number {
  const task = tasks.find(t => t.id === taskId)
  if (!task || !task.project) return 0
  return 1 + getDepth(task.project, tasks)
}

function formatDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── 型定義 ───────────────────────────────────────────────────
interface EditingCell {
  taskId: string
  field: 'name' | 'start' | 'end' | 'category' | 'url'
  value: string
}

interface DropInfo {
  targetId: string
  position: 'above' | 'below'
}

// ─── ヘッダー ─────────────────────────────────────────────────
interface HeaderProps {
  headerHeight: number
  rowWidth: string
  fontFamily: string
  fontSize: string
}

export function GanttTaskListHeader({ headerHeight, rowWidth, fontFamily, fontSize }: HeaderProps) {
  const cell: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 4px', fontWeight: 600, color: '#374151',
    fontSize, fontFamily, whiteSpace: 'nowrap', overflow: 'hidden',
    borderLeft: '1px solid #e5e7eb',
  }
  return (
    <div style={{
      display: 'flex', height: headerHeight, width: rowWidth,
      backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb',
      boxSizing: 'border-box',
    }}>
      <div style={{ width: DRAG_HANDLE_WIDTH, flexShrink: 0 }} />
      <div style={{ ...cell, width: CATEGORY_COL_WIDTH, justifyContent: 'flex-start', paddingLeft: 4 }}>
        カテゴリ
      </div>
      <div style={{ ...cell, flex: 1, justifyContent: 'flex-start', paddingLeft: BASE_PADDING }}>
        タスク名
      </div>
      <div style={{ ...cell, width: DATE_COL_WIDTH }}>開始日</div>
      <div style={{ ...cell, width: DATE_COL_WIDTH }}>終了日</div>
      <div style={{ ...cell, width: PROGRESS_COL_WIDTH }}>進捗%</div>
    </div>
  )
}

// ─── テーブル本体 ──────────────────────────────────────────────
interface TaskListTableProps {
  rowHeight: number
  rowWidth: string
  fontFamily: string
  fontSize: string
  locale: string
  tasks: GanttTask[]
  selectedTaskId: string
  setSelectedTask: (taskId: string) => void
  onExpanderClick: (task: GanttTask) => void
}

export function GanttTaskList({
  rowHeight, rowWidth, fontFamily, fontSize,
  tasks, selectedTaskId, setSelectedTask,
}: TaskListTableProps) {
  const storeTasks          = useTaskStore(s => s.tasks)
  const updateTask          = useTaskStore(s => s.updateTask)
  const reorderTask         = useTaskStore(s => s.reorderTask)
  const ganttCollapsedIds   = useTaskStore(s => s.ganttCollapsedIds)
  const toggleGanttCollapse = useTaskStore(s => s.toggleGanttCollapse)

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [dragId,   setDragId]   = useState<string | null>(null)
  const [dropInfo, setDropInfo] = useState<DropInfo | null>(null)

  const lastSiblingIds = useMemo(() => {
    const result = new Set<string>()
    const byParent = new Map<string | null, typeof storeTasks>()
    storeTasks.forEach(t => {
      const arr = byParent.get(t.parentId) ?? []
      arr.push(t)
      byParent.set(t.parentId, arr)
    })
    byParent.forEach(siblings => {
      const sorted = [...siblings].sort((a, b) => a.order - b.order)
      const last = sorted[sorted.length - 1]
      if (last) result.add(last.id)
    })
    return result
  }, [storeTasks])

  const startEdit = (taskId: string, field: EditingCell['field'], value: string) => {
    setSelectedTask(taskId)
    setEditingCell({ taskId, field, value })
  }

  const commitEdit = () => {
    if (!editingCell) return
    const { taskId, field, value } = editingCell
    if (field === 'name' && value.trim()) {
      updateTask(taskId, { name: value.trim() })
    } else if (field === 'category') {
      updateTask(taskId, { category: value.trim() || undefined })
    } else if (field === 'url') {
      updateTask(taskId, { url: value.trim() || undefined })
    }
    setEditingCell(null)
  }

  const isEditing = (taskId: string, field: EditingCell['field']) =>
    editingCell?.taskId === taskId && editingCell.field === field

  const dragParentId = dragId
    ? (storeTasks.find(t => t.id === dragId)?.parentId ?? null)
    : undefined

  return (
    <div style={{ fontFamily, fontSize, width: rowWidth, overflowX: 'visible' }}>
      {tasks.map(task => {
        const storeTask   = storeTasks.find(t => t.id === task.id)
        const depth       = getDepth(task.id, tasks)
        const isLast      = lastSiblingIds.has(task.id)
        const isProject   = tasks.some(t => t.project === task.id)
        const isSelected  = task.id === selectedTaskId
        const isCollapsed = ganttCollapsedIds.includes(task.id)
        const connector   = depth === 0 ? null : isLast ? '└' : '├'
        const paddingLeft = depth === 0 ? BASE_PADDING : (depth - 1) * INDENT_SIZE + BASE_PADDING

        const editingStart    = isEditing(task.id, 'start')
        const editingEnd      = isEditing(task.id, 'end')
        const editingName     = isEditing(task.id, 'name')
        const editingCategory = isEditing(task.id, 'category')
        const editingUrl      = isEditing(task.id, 'url')
        const hasUrl          = !!(storeTask?.url)

        const isDragging   = dragId === task.id
        const isDropTarget = dropInfo?.targetId === task.id
        const isSameLevel  = dragParentId !== undefined &&
          (storeTasks.find(t => t.id === task.id)?.parentId ?? null) === dragParentId

        return (
          <div
            key={task.id}
            draggable
            onDragStart={e => {
              setDragId(task.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={e => {
              e.preventDefault()
              if (!dragId || dragId === task.id || !isSameLevel) {
                e.dataTransfer.dropEffect = 'none'
                return
              }
              e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              const pos: 'above' | 'below' =
                e.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
              if (dropInfo?.targetId !== task.id || dropInfo.position !== pos) {
                setDropInfo({ targetId: task.id, position: pos })
              }
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropInfo(null)
              }
            }}
            onDrop={e => {
              e.preventDefault()
              if (dragId && dropInfo && dragId !== dropInfo.targetId) {
                reorderTask(dragId, dropInfo.targetId, dropInfo.position)
              }
              setDragId(null)
              setDropInfo(null)
            }}
            onDragEnd={() => { setDragId(null); setDropInfo(null) }}
            onClick={() => setSelectedTask(task.id)}
            style={{
              height: rowHeight,
              display: 'flex', alignItems: 'center',
              backgroundColor: isSelected ? '#eff6ff' : undefined,
              borderTop: isDropTarget && dropInfo?.position === 'above'
                ? '2px solid #3b82f6' : undefined,
              borderBottom: isDropTarget && dropInfo?.position === 'below'
                ? '2px solid #3b82f6' : '1px solid #f3f4f6',
              cursor: 'pointer', boxSizing: 'border-box', userSelect: 'none',
              overflow: 'visible', position: 'relative',
              opacity: isDragging ? 0.4 : 1,
            }}
          >
            {/* ── ドラッグハンドル ── */}
            <div
              title="ドラッグで並び替え（同レベルのみ）"
              style={{
                width: DRAG_HANDLE_WIDTH, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'grab', color: '#d1d5db', fontSize: 13,
              }}
            >
              ⠿
            </div>

            {/* ── カテゴリ列 ── */}
            <div
              style={{
                width: editingCategory ? Math.max(CATEGORY_COL_WIDTH, 110) : CATEGORY_COL_WIDTH,
                flexShrink: 0, display: 'flex', alignItems: 'center',
                borderLeft: '1px solid #f3f4f6',
                position: 'relative', zIndex: editingCategory ? 10 : undefined,
                overflow: 'visible',
              }}
              onClick={e => e.stopPropagation()}
            >
              {editingCategory ? (
                <input
                  type="text"
                  autoFocus
                  value={editingCell!.value}
                  onChange={e => setEditingCell(prev => prev ? { ...prev, value: e.target.value } : null)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingCell(null)
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    width: '100%', fontSize: '11px',
                    border: '1px solid #3b82f6', borderRadius: 3,
                    padding: '1px 4px', outline: 'none', background: 'white',
                  }}
                />
              ) : (
                <span
                  title="クリックで編集"
                  onClick={() => startEdit(task.id, 'category', storeTask?.category ?? '')}
                  style={{
                    display: 'block', width: '100%',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontSize: '11px', padding: '0 4px',
                    color: storeTask?.category ? '#6b7280' : '#d1d5db',
                    cursor: 'text', borderBottom: '1px dashed transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderBottomColor = '#93c5fd')}
                  onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                >
                  {storeTask?.category || '—'}
                </span>
              )}
            </div>

            {/* ── 名前列 ── */}
            <div style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center',
              paddingLeft, paddingRight: 4, overflow: 'visible',
              borderLeft: '1px solid #f3f4f6',
              position: 'relative', zIndex: editingUrl ? 10 : undefined,
            }}>
              {connector && (
                <span style={{ fontFamily: 'monospace', color: '#9ca3af', marginRight: 3, flexShrink: 0 }}>
                  {connector}
                </span>
              )}
              {isProject && (
                <button
                  onClick={e => { e.stopPropagation(); toggleGanttCollapse(task.id) }}
                  title={isCollapsed ? '展開する' : '折りたたむ'}
                  style={{
                    background: 'none', border: 'none', padding: '0 3px 0 0',
                    cursor: 'pointer', fontSize: 9, color: '#6b7280',
                    flexShrink: 0, lineHeight: 1,
                  }}
                >
                  {isCollapsed ? '▶' : '▼'}
                </button>
              )}

              {editingUrl ? (
                /* URL 入力モード */
                <input
                  type="url"
                  autoFocus
                  placeholder="https://..."
                  value={editingCell!.value}
                  onChange={e => setEditingCell(prev => prev ? { ...prev, value: e.target.value } : null)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingCell(null)
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    flex: 1, minWidth: 0, fontSize: '11px',
                    border: '1px solid #3b82f6', borderRadius: 3,
                    padding: '1px 4px', outline: 'none', background: 'white',
                  }}
                />
              ) : editingName ? (
                /* 名前編集モード */
                <input
                  type="text"
                  autoFocus
                  value={editingCell!.value}
                  onChange={e => setEditingCell(prev => prev ? { ...prev, value: e.target.value } : null)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingCell(null)
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    flex: 1, minWidth: 0, fontSize: '12px',
                    border: '1px solid #3b82f6', borderRadius: 3,
                    padding: '1px 4px', outline: 'none', background: 'white',
                  }}
                />
              ) : (
                /* 通常表示 */
                <span
                  title={`クリックで編集: ${task.name}`}
                  onClick={e => { e.stopPropagation(); startEdit(task.id, 'name', task.name) }}
                  style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isProject ? 600 : 400,
                    color: isSelected ? '#1d4ed8' : isProject ? '#374151' : '#4b5563',
                    borderBottom: '1px dashed transparent', cursor: 'text',
                    flex: 1, minWidth: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderBottomColor = '#93c5fd')}
                  onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                >
                  {task.name}
                </span>
              )}

              {/* URL ボタン */}
              {!editingName && !editingUrl && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    if (hasUrl) {
                      window.open(storeTask!.url, '_blank', 'noopener,noreferrer')
                    } else {
                      startEdit(task.id, 'url', '')
                    }
                  }}
                  onContextMenu={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    startEdit(task.id, 'url', storeTask?.url ?? '')
                  }}
                  title={hasUrl
                    ? `${storeTask!.url}\n（右クリックでURL編集）`
                    : 'URLを設定'}
                  style={{
                    flexShrink: 0, background: 'none', border: 'none',
                    cursor: 'pointer', padding: '0 2px', lineHeight: 1,
                    fontSize: 12,
                    color: hasUrl ? '#3b82f6' : '#d1d5db',
                    opacity: hasUrl ? 1 : 0,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
                  onMouseLeave={e => {
                    if (!hasUrl) (e.currentTarget as HTMLButtonElement).style.opacity = '0'
                  }}
                >
                  🔗
                </button>
              )}
            </div>

            {/* ── 開始日列 ── */}
            <div
              style={{
                width: editingStart ? DATE_COL_EDIT_WIDTH : DATE_COL_WIDTH,
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderLeft: '1px solid #f3f4f6',
                position: 'relative', zIndex: editingStart ? 10 : undefined,
              }}
              onClick={e => e.stopPropagation()}
            >
              {editingStart ? (
                <input
                  type="date" autoFocus
                  defaultValue={toInputDate(task.start)}
                  onChange={e => { if (e.target.value) { updateTask(task.id, { start: e.target.value }); setEditingCell(null) } }}
                  onBlur={() => setEditingCell(null)}
                  style={{ width: '100%', fontSize: '11px', border: '1px solid #3b82f6', borderRadius: 3, padding: '1px 2px', outline: 'none' }}
                />
              ) : (
                <span
                  title="クリックで編集"
                  onClick={() => startEdit(task.id, 'start', toInputDate(task.start))}
                  style={{ fontSize: '11px', color: '#6b7280', cursor: 'pointer', borderBottom: '1px dashed transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.borderBottomColor = '#93c5fd')}
                  onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                >
                  {formatDate(task.start)}
                </span>
              )}
            </div>

            {/* ── 終了日列 ── */}
            <div
              style={{
                width: editingEnd ? DATE_COL_EDIT_WIDTH : DATE_COL_WIDTH,
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderLeft: '1px solid #f3f4f6',
                position: 'relative', zIndex: editingEnd ? 10 : undefined,
              }}
              onClick={e => e.stopPropagation()}
            >
              {editingEnd ? (
                <input
                  type="date" autoFocus
                  defaultValue={toInputDate(task.end)}
                  onChange={e => { if (e.target.value) { updateTask(task.id, { end: e.target.value }); setEditingCell(null) } }}
                  onBlur={() => setEditingCell(null)}
                  style={{ width: '100%', fontSize: '11px', border: '1px solid #3b82f6', borderRadius: 3, padding: '1px 2px', outline: 'none' }}
                />
              ) : (
                <span
                  title="クリックで編集"
                  onClick={() => startEdit(task.id, 'end', toInputDate(task.end))}
                  style={{ fontSize: '11px', color: '#6b7280', cursor: 'pointer', borderBottom: '1px dashed transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.borderBottomColor = '#93c5fd')}
                  onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                >
                  {formatDate(task.end)}
                </span>
              )}
            </div>

            {/* ── 進捗列 ── */}
            <div
              style={{
                width: PROGRESS_COL_WIDTH, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 2, borderLeft: '1px solid #f3f4f6',
              }}
              onClick={e => e.stopPropagation()}
            >
              <input
                type="number" min={0} max={100}
                value={task.progress}
                onChange={e => updateTask(task.id, { progress: Math.max(0, Math.min(100, Number(e.target.value))) })}
                onClick={e => e.stopPropagation()}
                style={{ width: 40, textAlign: 'right', border: '1px solid #d1d5db', borderRadius: 4, padding: '1px 3px', fontSize: '11px', outline: 'none', background: 'white' }}
              />
              <span style={{ fontSize: '11px', color: '#9ca3af', flexShrink: 0 }}>%</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
