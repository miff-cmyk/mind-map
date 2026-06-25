import { useEffect, useMemo, useRef, useState } from 'react'
import { Gantt, ViewMode } from 'gantt-task-react'
import 'gantt-task-react/dist/index.css'
import type { Task as GanttTask } from 'gantt-task-react'
import type { Task } from '../../types/task'
import { colorToHex } from '../../types/task'
import { useTaskStore } from '../../store/taskStore'
import { GanttTaskList, GanttTaskListHeader, LIST_CELL_WIDTH } from './GanttTaskList'

// ─── 定数 ────────────────────────────────────────────────────────────
const HEADER_DAY     = 64   // 日ビュー用ヘッダー高さ（2 行分）
const HEADER_DEFAULT = 50   // 週 / 月ビュー

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

// ─── ユーティリティ ───────────────────────────────────────────────────

/** 進捗率に応じたバーの色 */
function getProgressColor(progress: number): string {
  if (progress === 100) return '#22c55e'
  if (progress >= 70)   return '#3b82f6'
  if (progress >= 30)   return '#f59e0b'
  return '#ef4444'
}

function dfsSorted(tasks: Task[]): Task[] {
  const childrenMap = new Map<string | null, Task[]>()
  tasks.forEach(t => {
    const arr = childrenMap.get(t.parentId) ?? []
    arr.push(t)
    childrenMap.set(t.parentId, arr)
  })
  const result: Task[] = []
  function visit(parentId: string | null) {
    const children = (childrenMap.get(parentId) ?? []).sort((a, b) => a.order - b.order)
    for (const child of children) {
      result.push(child)
      visit(child.id)
    }
  }
  visit(null)
  return result
}

function toGanttTask(task: Task): GanttTask {
  const hex = colorToHex(task.color)
  const start = new Date(task.start)
  const end = new Date(task.end)
  if (end <= start) end.setDate(start.getDate() + 1)

  return {
    id: task.id,
    name: task.name,
    start,
    end,
    progress: task.progress,
    type: 'task',
    project: task.parentId ?? undefined,
    styles: {
      backgroundColor: hex,
      backgroundSelectedColor: hex + 'cc',
      progressColor: getProgressColor(task.progress),
      progressSelectedColor: getProgressColor(task.progress) + 'cc',
    },
  }
}

/** 折りたたまれた親の子孫を除外する */
function filterByCollapsed(ganttTasks: GanttTask[], collapsedIds: string[]): GanttTask[] {
  if (collapsedIds.length === 0) return ganttTasks
  const collapsedSet = new Set(collapsedIds)
  function isHidden(task: GanttTask): boolean {
    if (!task.project) return false
    if (collapsedSet.has(task.project)) return true
    const parent = ganttTasks.find(t => t.id === task.project)
    return parent ? isHidden(parent) : false
  }
  return ganttTasks.filter(t => !isHidden(t))
}

/**
 * ライブラリの ganttDateRange + seedDates と同じロジックで
 * 日ビュー時に表示される全日付の配列を返す (preStepsCount=1)
 *
 * Day:  startDate = midnight(minStart) - 1 day
 *       endDate   = midnight(maxEnd)   + 19 days
 *       1日刻みで startDate..endDate (両端含む)
 */
function calcDisplayDates(tasks: GanttTask[], mode: ViewMode): Date[] {
  if (tasks.length === 0 || mode !== ViewMode.Day) return []

  let minStart = tasks[0].start
  let maxEnd   = tasks[0].end
  for (const t of tasks) {
    if (t.start < minStart) minStart = t.start
    if (t.end   > maxEnd)   maxEnd   = t.end
  }

  const startDate = new Date(minStart)
  startDate.setHours(0, 0, 0, 0)
  startDate.setDate(startDate.getDate() - 1)   // preStepsCount = 1

  const endDate = new Date(maxEnd)
  endDate.setHours(0, 0, 0, 0)
  endDate.setDate(endDate.getDate() + 19)       // ライブラリが加算する 19 日

  const dates: Date[] = []
  const cur = new Date(startDate)
  while (cur <= endDate) {
    dates.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// ─── VIEW MODE 設定 ───────────────────────────────────────────────────
const VIEW_MODES: { label: string; mode: ViewMode }[] = [
  { label: '日', mode: ViewMode.Day },
  { label: '週', mode: ViewMode.Week },
  { label: '月', mode: ViewMode.Month },
]

// ─── メインコンポーネント ─────────────────────────────────────────────
export default function GanttView() {
  const tasks            = useTaskStore(s => s.tasks)
  const selectedTaskId   = useTaskStore(s => s.selectedTaskId)
  const ganttCollapsedIds = useTaskStore(s => s.ganttCollapsedIds)
  const selectTask       = useTaskStore(s => s.selectTask)
  const updateTask       = useTaskStore(s => s.updateTask)

  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // viewMode に応じた列幅・ヘッダー高さ
  const colWidth  = viewMode === ViewMode.Month ? 300 : viewMode === ViewMode.Week ? 65 : 20
  const headerH   = viewMode === ViewMode.Day ? HEADER_DAY : HEADER_DEFAULT

  const visibleGanttTasks = useMemo(() => {
    const sorted     = dfsSorted(tasks)
    const ganttTasks = sorted.map(t => toGanttTask(t))
    const filtered   = filterByCollapsed(ganttTasks, ganttCollapsedIds)
    // displayOrder=0 はライブラリが Number.MAX_VALUE 扱いするため 1 始まりで連番を振る
    return filtered.map((t, i) => ({ ...t, displayOrder: i + 1 }))
  }, [tasks, ganttCollapsedIds])

  // ── DOM 注入: 土日色 + カレンダーヘッダー 2 行化 (日ビューのみ) ────
  useEffect(() => {
    const container = wrapperRef.current
    if (!container || visibleGanttTasks.length === 0) return

    const svgs = container.querySelectorAll<SVGSVGElement>('svg')
    if (svgs.length < 2) return

    const calSVG   = svgs[0]   // カレンダーヘッダー SVG
    const chartSVG = svgs[1]   // チャート本体 SVG

    // 前回の注入を削除
    ;[calSVG, chartSVG].forEach(svg =>
      svg.querySelectorAll('.gc').forEach(el => el.remove()),
    )

    if (viewMode !== ViewMode.Day) return   // 日ビュー以外は終了

    // ライブラリと同一ロジックで全表示日付を算出（DOM 読み取りを使わない）
    const displayDates = calcDisplayDates(visibleGanttTasks, viewMode)
    if (displayDates.length === 0) return

    const todayMs = new Date().setHours(0, 0, 0, 0)
    const topH    = HEADER_DAY / 2   // 月名エリアとの境界 y 座標 (= 32)
    const botH    = HEADER_DAY - topH // 下半分の高さ (= 32)

    // ── カレンダー SVG: 日付 + 曜日を 2 行で描画 ──────────────────
    displayDates.forEach((date, i) => {
      const x   = i * colWidth
      const cx  = x + colWidth / 2
      const dow = date.getDay()
      const isToday = date.getTime() === todayMs

      // 土日・今日の背景色（カレンダーヘッダー下半分）
      if (isToday || dow === 6 || dow === 0) {
        const bgFill =
          isToday   ? 'rgba(255, 255,  80, 0.55)' :
          dow === 6 ? 'rgba(173, 216, 230, 0.55)' :
                      'rgba(255, 182, 193, 0.55)'
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        bg.setAttribute('x',      String(x))
        bg.setAttribute('y',      String(topH))
        bg.setAttribute('width',  String(colWidth))
        bg.setAttribute('height', String(botH))
        bg.setAttribute('fill',   bgFill)
        bg.classList.add('gc')
        calSVG.appendChild(bg)
      }

      // 日付数字（上）
      const dt = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      dt.setAttribute('x',                  String(cx))
      dt.setAttribute('y',                  String(topH + botH * 0.36))
      dt.setAttribute('text-anchor',        'middle')
      dt.setAttribute('dominant-baseline',  'middle')
      dt.setAttribute('font-size',          '9')
      dt.setAttribute('fill',  isToday ? '#92400e' : '#222')
      dt.setAttribute('font-weight', isToday ? '700' : '400')
      dt.classList.add('gc')
      dt.textContent = String(date.getDate())
      calSVG.appendChild(dt)

      // 曜日（下）
      const wt = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      wt.setAttribute('x',                  String(cx))
      wt.setAttribute('y',                  String(topH + botH * 0.80))
      wt.setAttribute('text-anchor',        'middle')
      wt.setAttribute('dominant-baseline',  'middle')
      wt.setAttribute('font-size',          '8')
      wt.setAttribute('fill',
        dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : '#888')
      wt.classList.add('gc')
      wt.textContent = DAY_NAMES[dow]
      calSVG.appendChild(wt)
    })

    // ── チャート SVG: 土日列に着色 ──────────────────────────────
    const chartH = parseFloat(chartSVG.getAttribute('height') ?? '0')
    const gridG  = chartSVG.querySelector<SVGGElement>('g.grid')
    if (!gridG || !chartH) return

    displayDates.forEach((date, i) => {
      const dow = date.getDay()
      if (dow !== 6 && dow !== 0) return

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x',      String(i * colWidth))
      rect.setAttribute('y',      '0')
      rect.setAttribute('width',  String(colWidth))
      rect.setAttribute('height', String(chartH))
      rect.setAttribute('fill',
        dow === 6 ? 'rgba(173, 216, 230, 0.45)' : 'rgba(255, 182, 193, 0.45)')
      rect.classList.add('gc')
      gridG.appendChild(rect)
    })
  }, [visibleGanttTasks, viewMode, colWidth])

  // ─────────────────────────────────────────────────────────────────
  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">マインドマップタブでタスクを追加してください</p>
      </div>
    )
  }

  const legendItems = [
    { label: '未着手 (0〜29%)',   color: '#ef4444' },
    { label: '進行中 (30〜69%)', color: '#f59e0b' },
    { label: '順調 (70〜99%)',   color: '#3b82f6' },
    { label: '完了 (100%)',      color: '#22c55e' },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ツールバー */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="flex gap-1">
          {VIEW_MODES.map(({ label, mode }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                viewMode === mode
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 ml-4">
          {legendItems.map(item => (
            <div key={item.label} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
              <span className="text-xs text-gray-500">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ガントチャート本体 */}
      <div className="flex-1 overflow-auto p-4">
        {/* 日ビュー時: ライブラリの "曜日, 日付" 結合テキストを CSS で非表示にする */}
        {viewMode === ViewMode.Day && (
          <style>{`.gantt-day-view ._9w8d5 { visibility: hidden; }`}</style>
        )}
        {/* minWidth: max-content で flex-shrink を防ぎ、全日付を表示できるようにする */}
        <div
          ref={wrapperRef}
          className={viewMode === ViewMode.Day ? 'gantt-day-view' : ''}
          style={{ minWidth: 'max-content' }}
        >
          <Gantt
            tasks={visibleGanttTasks}
            viewMode={viewMode}
            locale="ja-JP"
            headerHeight={headerH}
            todayColor="rgba(255, 255, 0, 0.28)"
            onSelect={task => selectTask(task.id === selectedTaskId ? null : task.id)}
            onDateChange={(task, children) => {
              updateTask(task.id, {
                start: task.start.toISOString().slice(0, 10),
                end:   task.end.toISOString().slice(0, 10),
              })
              children.forEach(child => {
                updateTask(child.id, {
                  start: child.start.toISOString().slice(0, 10),
                  end:   child.end.toISOString().slice(0, 10),
                })
              })
            }}
            onProgressChange={task => {
              updateTask(task.id, { progress: Math.round(task.progress) })
            }}
            rowHeight={28}
            listCellWidth={`${LIST_CELL_WIDTH}px`}
            columnWidth={colWidth}
            TaskListTable={GanttTaskList}
            TaskListHeader={GanttTaskListHeader}
          />
        </div>
      </div>
    </div>
  )
}
