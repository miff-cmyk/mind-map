import { useTaskStore } from '../../store/taskStore'
import { COLOR_OPTIONS } from '../../types/task'

export default function EditPanel() {
  const tasks = useTaskStore(s => s.tasks)
  const selectedTaskId = useTaskStore(s => s.selectedTaskId)
  const selectTask = useTaskStore(s => s.selectTask)
  const updateTask = useTaskStore(s => s.updateTask)
  const addTask = useTaskStore(s => s.addTask)
  const deleteTask = useTaskStore(s => s.deleteTask)

  const task = tasks.find(t => t.id === selectedTaskId)

  if (!task) {
    return (
      <div className="w-64 border-l border-gray-200 bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm text-center px-4">
          タスクを選択すると<br />ここで編集できます
        </p>
      </div>
    )
  }

  const handleDelete = () => {
    if (window.confirm(`「${task.name}」を削除しますか？\n子タスクもすべて削除されます。`)) {
      deleteTask(task.id)
      selectTask(null)
    }
  }

  return (
    <div className="w-64 border-l border-gray-200 bg-white flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-700 text-sm">タスクを編集</h2>
      </div>

      <div className="p-4 flex flex-col gap-4 flex-1">
        {/* 優先度 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">優先度</label>
          <select
            value={task.priority ?? ''}
            onChange={e => updateTask(task.id, { priority: (e.target.value as 'high'|'medium'|'low') || undefined })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="">未設定</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </div>

        {/* 担当者 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">担当者</label>
          <input
            type="text"
            placeholder="担当者名を入力..."
            value={task.assignee ?? ''}
            onChange={e => updateTask(task.id, { assignee: e.target.value || undefined })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* カテゴリ */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">カテゴリ</label>
          <input
            type="text"
            placeholder="カテゴリを入力..."
            value={task.category ?? ''}
            onChange={e => updateTask(task.id, { category: e.target.value || undefined })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* タスク名 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">タスク名</label>
          <input
            type="text"
            value={task.name}
            onChange={e => updateTask(task.id, { name: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* 開始日 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">開始日</label>
          <input
            type="date"
            value={task.start}
            onChange={e => updateTask(task.id, { start: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* 終了日 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">終了日</label>
          <input
            type="date"
            value={task.end}
            onChange={e => updateTask(task.id, { end: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* 進捗 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            進捗: {task.progress}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={task.progress}
            onChange={e => updateTask(task.id, { progress: Number(e.target.value) })}
            className="w-full accent-blue-500"
          />
        </div>

        {/* 色 */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">色</label>
          <div className="flex gap-2 flex-wrap">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c.value}
                title={c.label}
                onClick={() => updateTask(task.id, { color: c.value })}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  task.color === c.value ? 'border-gray-800 scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>

        {/* コメント */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">コメント</label>
          <textarea
            rows={4}
            placeholder="メモや詳細を入力..."
            value={task.comment ?? ''}
            onChange={e => updateTask(task.id, { comment: e.target.value || undefined })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          />
        </div>

        {/* URL */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">リンクURL</label>
          <input
            type="url"
            placeholder="https://..."
            value={task.url ?? ''}
            onChange={e => updateTask(task.id, { url: e.target.value || undefined })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {task.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-1 text-xs text-blue-500 hover:underline truncate"
            >
              開く ↗ {task.url}
            </a>
          )}
        </div>
      </div>

      {/* ボタン */}
      <div className="p-4 border-t border-gray-100 flex flex-col gap-2">
        <button
          onClick={() => addTask(task.id)}
          className="w-full py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
        >
          + 子タスクを追加
        </button>
        <button
          onClick={handleDelete}
          className="w-full py-2 bg-red-50 text-red-500 text-sm rounded hover:bg-red-100 transition-colors border border-red-200"
        >
          削除
        </button>
      </div>
    </div>
  )
}
