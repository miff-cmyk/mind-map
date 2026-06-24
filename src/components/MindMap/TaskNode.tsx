import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { Task } from '../../types/task'
import { colorToHex } from '../../types/task'
import { useTaskStore } from '../../store/taskStore'

export interface TaskNodeData {
  task: Task
  selected: boolean
  hasChildren: boolean
}

function TaskNode({ data }: NodeProps<TaskNodeData>) {
  const { task, selected, hasChildren } = data
  const hex = colorToHex(task.color)

  const updateTask = useTaskStore(s => s.updateTask)
  const toggleCollapse = useTaskStore(s => s.toggleCollapse)
  const collapsedIds = useTaskStore(s => s.collapsedIds)
  const isCollapsed = collapsedIds.includes(task.id)

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(task.name)
  const inputRef = useRef<HTMLInputElement>(null)

  // 編集開始時にフォーカス
  useEffect(() => {
    if (isEditing) {
      setEditValue(task.name)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [isEditing, task.name])

  const commitEdit = useCallback(() => {
    setIsEditing(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== task.name) {
      updateTask(task.id, { name: trimmed })
    }
  }, [editValue, task.id, task.name, updateTask])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }, [])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') {
      setIsEditing(false)
      setEditValue(task.name)
    }
  }, [commitEdit, task.name])

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (task.url) window.open(task.url, '_blank', 'noopener,noreferrer')
  }, [task.url])

  const handleCollapseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    toggleCollapse(task.id)
  }, [task.id, toggleCollapse])

  return (
    <div
      className={`
        bg-white rounded-lg shadow-md px-3 py-2 min-w-[150px] max-w-[220px]
        border-2 transition-colors select-none
        ${selected ? 'border-blue-500' : 'border-gray-200'}
      `}
      onDoubleClick={handleDoubleClick}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />

      {/* タスク名 / インライン編集 */}
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: hex }}
        />
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleInputKeyDown}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            className="flex-1 text-sm font-medium text-gray-800 border-b border-blue-400 outline-none bg-transparent min-w-0"
          />
        ) : (
          <span className="text-sm font-medium text-gray-800 truncate flex-1">{task.name}</span>
        )}

        {/* URL リンクアイコン */}
        {task.url && !isEditing && (
          <button
            onClick={handleLinkClick}
            title={task.url}
            className="flex-shrink-0 text-blue-400 hover:text-blue-600 text-xs leading-none"
          >
            🔗
          </button>
        )}
      </div>

      {/* 進捗バー */}
      <div className="w-full bg-gray-200 rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${task.progress}%`, backgroundColor: hex }}
        />
      </div>
      <div className="text-xs text-gray-400 mt-0.5 text-right">{task.progress}%</div>

      {/* 折りたたみボタン（子を持つノードのみ） */}
      {hasChildren && (
        <button
          onClick={handleCollapseClick}
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 text-[10px] flex items-center justify-center hover:bg-gray-100 shadow-sm"
          title={isCollapsed ? '展開する' : '折りたたむ'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
      )}

      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  )
}

export default memo(TaskNode)
