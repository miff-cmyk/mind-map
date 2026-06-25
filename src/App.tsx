import { useEffect, useRef, useState } from 'react'
import { useTaskStore } from './store/taskStore'
import MindMapView from './components/MindMap/MindMapView'
import GanttView from './components/Gantt/GanttView'
import EditPanel from './components/EditPanel/EditPanel'

type Tab = 'mindmap' | 'gantt'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('mindmap')
  const loadFromStorage = useTaskStore(s => s.loadFromStorage)
  const isLoaded = useTaskStore(s => s.isLoaded)
  const exportData = useTaskStore(s => s.exportData)
  const importData = useTaskStore(s => s.importData)
  const exportCSV  = useTaskStore(s => s.exportCSV)
  const importCSV  = useTaskStore(s => s.importCSV)
  const addTask = useTaskStore(s => s.addTask)
  const deleteTask = useTaskStore(s => s.deleteTask)
  const tasks = useTaskStore(s => s.tasks)
  const selectedTaskId = useTaskStore(s => s.selectedTaskId)
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const csvInputRef     = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadFromStorage()
  }, [loadFromStorage])

  // キーボードショートカット（Enter: 同階層追加 / Tab: 子タスク追加）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // input / textarea にフォーカス中は無視
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (!selectedTaskId) return

      const selectedTask = tasks.find(t => t.id === selectedTaskId)
      if (!selectedTask) return

      if (e.key === 'Enter') {
        e.preventDefault()
        addTask(selectedTask.parentId, selectedTaskId)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        addTask(selectedTaskId)
      } else if (e.key === 'Delete') {
        e.preventDefault()
        deleteTask(selectedTaskId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, tasks, addTask])

  const handleImportClick    = () => fileInputRef.current?.click()
  const handleCSVImportClick = () => csvInputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      if (typeof ev.target?.result === 'string') importData(ev.target.result)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleCSVFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      if (typeof ev.target?.result === 'string') importCSV(ev.target.result)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  if (!isLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* ヘッダー */}
      <header className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        {/* タブ */}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('mindmap')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === 'mindmap'
                ? 'bg-blue-500 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            マインドマップ
          </button>
          <button
            onClick={() => setActiveTab('gantt')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === 'gantt'
                ? 'bg-blue-500 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            ガントチャート
          </button>
        </div>

        <div className="flex-1" />

        {/* ルートタスク追加ボタン（タスクがある場合） */}
        {tasks.length > 0 && (
          <button
            onClick={() => addTask(null)}
            className="px-3 py-1.5 text-sm text-blue-500 border border-blue-300 rounded hover:bg-blue-50 transition-colors"
          >
            + ルートタスク
          </button>
        )}

        {/* JSON 書き出し / 読み込み */}
        <button
          onClick={exportData}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          JSON書き出し
        </button>
        <button
          onClick={handleImportClick}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          JSON読み込み
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* CSV 書き出し / 読み込み */}
        <button
          onClick={exportCSV}
          className="px-3 py-1.5 text-sm text-green-700 border border-green-400 rounded hover:bg-green-50 transition-colors"
        >
          CSV書き出し
        </button>
        <button
          onClick={handleCSVImportClick}
          className="px-3 py-1.5 text-sm text-green-700 border border-green-400 rounded hover:bg-green-50 transition-colors"
        >
          CSV読み込み
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleCSVFileChange}
        />
      </header>

      {/* メインコンテンツ */}
      <div className="flex flex-1 overflow-hidden">
        {activeTab === 'mindmap' ? <MindMapView /> : <GanttView />}
        <EditPanel />
      </div>
    </div>
  )
}
