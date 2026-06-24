import { useCallback, useEffect, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type Connection,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from '@dagrejs/dagre'
import type { Task } from '../../types/task'
import { useTaskStore } from '../../store/taskStore'
import TaskNode from './TaskNode'
import type { TaskNodeData } from './TaskNode'

const NODE_WIDTH = 220
const NODE_HEIGHT = 80

const nodeTypes = { taskNode: TaskNode }

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 60 })

  nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)

  return nodes.map(n => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } }
  })
}

/** 折りたたまれた祖先を持つタスクを除外 */
function getVisibleTasks(tasks: Task[], collapsedIds: string[]): Task[] {
  if (collapsedIds.length === 0) return tasks
  const collapsedSet = new Set(collapsedIds)

  function isHidden(task: Task): boolean {
    if (task.parentId === null) return false
    if (collapsedSet.has(task.parentId)) return true
    const parent = tasks.find(t => t.id === task.parentId)
    return parent ? isHidden(parent) : false
  }

  return tasks.filter(t => !isHidden(t))
}

function tasksToFlow(tasks: Task[], selectedTaskId: string | null, collapsedIds: string[]) {
  const visibleTasks = getVisibleTasks(tasks, collapsedIds)
  const visibleIds = new Set(visibleTasks.map(t => t.id))

  const nodes: Node<TaskNodeData>[] = visibleTasks.map(t => ({
    id: t.id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: {
      task: t,
      selected: t.id === selectedTaskId,
      hasChildren: tasks.some(c => c.parentId === t.id),  // 全タスクで判定（折りたたみ中も含む）
    },
  }))

  const edges: Edge[] = visibleTasks
    .filter(t => t.parentId !== null && visibleIds.has(t.parentId))
    .map(t => ({
      id: `e-${t.parentId}-${t.id}`,
      source: t.parentId!,
      target: t.id,
      type: 'smoothstep',
    }))

  const layouted = getLayoutedElements(nodes, edges)
  return { nodes: layouted, edges }
}

export default function MindMapView() {
  const tasks = useTaskStore(s => s.tasks)
  const selectedTaskId = useTaskStore(s => s.selectedTaskId)
  const collapsedIds = useTaskStore(s => s.collapsedIds)
  const selectTask = useTaskStore(s => s.selectTask)
  const addTask = useTaskStore(s => s.addTask)
  const updateTask = useTaskStore(s => s.updateTask)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => tasksToFlow(tasks, selectedTaskId, collapsedIds),
    [tasks, selectedTaskId, collapsedIds]
  )

  useEffect(() => {
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges])

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    selectTask(node.id)
  }, [selectTask])

  const onPaneClick = useCallback(() => {
    selectTask(null)
  }, [selectTask])

  /** Handle をドラッグして別ノードに繋ぐ → parentId を変更 */
  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target && connection.source !== connection.target) {
      updateTask(connection.target, { parentId: connection.source })
    }
  }, [updateTask])

  /** エッジを削除（選択して Delete キー）→ parentId を null（ルートに昇格） */
  const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    deletedEdges.forEach(edge => updateTask(edge.target, { parentId: null }))
  }, [updateTask])

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-400 mb-4">タスクがまだありません</p>
          <button
            onClick={() => addTask(null)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            ルートタスクを追加
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode="Delete"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
