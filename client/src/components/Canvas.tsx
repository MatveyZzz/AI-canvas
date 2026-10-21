import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store/useStore';
import { TYPE_COLOR, NodeCard, type CanvasNodeData } from './NodeCard';
import { BranchDialog } from './BranchDialog';
import type { EdgeKind, EdgeRow, NodeRow } from '../lib/types';
import { NODE_TYPE_META } from '../lib/types';

const EDGE_STYLE: Record<EdgeKind, { stroke: string; strokeDasharray?: string; markerEnd: { type: 'arrowclosed' as const; color: string } }> = {
  parent: { stroke: '#34d399', markerEnd: { type: 'arrowclosed', color: '#34d399' } },
  related: { stroke: '#64748b', strokeDasharray: '5 4', markerEnd: { type: 'arrowclosed', color: '#64748b' } },
  derived: { stroke: '#a78bfa', strokeDasharray: '1 5', markerEnd: { type: 'arrowclosed', color: '#a78bfa' } },
};

function toFlowNode(n: NodeRow): Node<CanvasNodeData> {
  return {
    id: n.id,
    type: 'card',
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    hidden: n.hidden === 1,
    data: { row: n },
    style: { background: 'transparent' },
  };
}

function toFlowEdge(e: EdgeRow): Edge {
  const st = EDGE_STYLE[e.kind] ?? EDGE_STYLE.related;
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.kind === 'parent',
    style: { stroke: st.stroke, strokeDasharray: st.strokeDasharray },
    markerEnd: st.markerEnd,
    data: { kind: e.kind },
  };
}

export function Canvas() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const workspaceId = useStore((s) => s.workspaceId);
  const addEdge = useStore((s) => s.addEdge);
  const removeEdge = useStore((s) => s.removeEdge);
  const changeEdgeKind = useStore((s) => s.changeEdgeKind);
  const commitNodePatch = useStore((s) => s.commitNodePatch);
  const setMultiSelected = useStore((s) => s.setMultiSelected);
  const saveViewport = useStore((s) => s.saveViewport);
  const rf = useReactFlow();

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; edgeId: string; kind: EdgeKind } | null>(null);
  const [branchSource, setBranchSource] = useState<string | null>(null);

  // Sync store -> flow when the structural shape changes (not during drags).
  const signature = useMemo(() => nodes.map((n) => `${n.id}:${n.x},${n.y}`).join('|') + '#' + edges.map((e) => e.id).join('|'), [nodes, edges]);
  const lastSig = useRef('');
  useEffect(() => {
    if (lastSig.current !== signature || flowNodes.length !== nodes.length) {
      lastSig.current = signature;
      setFlowNodes(nodes.map(toFlowNode));
      setFlowEdges(edges.map(toFlowEdge));
    } else {
      // keep positions fresh but don't disturb drag state; update data rows
      setFlowNodes((prev) =>
        prev.map((fn) => {
          const row = nodes.find((n) => n.id === fn.id);
          if (!row) return fn;
          return { ...fn, data: { row }, hidden: row.hidden === 1, width: row.width, height: row.height };
        }),
      );
      setFlowEdges(edges.map(toFlowEdge));
    }
  }, [signature, nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore viewport per workspace (once per load)
  const appliedVpFor = useRef<string | null>(null);
  useEffect(() => {
    if (!workspaceId || appliedVpFor.current === workspaceId) return;
    const st = useStore.getState();
    if (st.pendingViewport) {
      void rf.setViewport(st.pendingViewport, { instant: true });
      appliedVpFor.current = workspaceId;
    } else if (nodes.length && flowNodes.length) {
      void rf.fitView({ padding: 0.15, maxZoom: 1 });
      appliedVpFor.current = workspaceId;
    }
  }, [workspaceId, nodes.length, flowNodes.length]); // eslint-disable-line

  const nodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      void commitNodePatch(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
    },
    [commitNodePatch],
  );

  const selectionChange = useCallback(
    (params: { nodes?: Node[]; edges?: Edge[] }) => {
      setMultiSelected((params.nodes ?? []).map((n) => n.id));
    },
    [setMultiSelected],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) void addEdge(c.source, c.target, 'related');
    },
    [addEdge],
  );

  const onPaneClick = useCallback(() => {
    setMenu(null);
    setEdgeMenu(null);
  }, []);

  const onDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    useStore.getState().setExpanded(node.id);
  }, []);

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    const flow = (e as React.MouseEvent).nativeEvent ? rf.screenToFlowPosition({ x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY }) : { x: 0, y: 0 };
    setEdgeMenu(null);
    setMenu({ x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY, flowX: flow.x, flowY: flow.y });
  }, [rf]);

  const onEdgeContextMenu = useCallback((e: MouseEvent | React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const me = e as React.MouseEvent;
    setMenu(null);
    setEdgeMenu({ x: me.clientX, y: me.clientY, edgeId: edge.id, kind: ((edge.data as { kind?: EdgeKind })?.kind ?? 'related') });
  }, []);

  const branchNode = branchSource ? nodes.find((n) => n.id === branchSource) : null;

  return (
    <>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={{ card: NodeCard }}
        onNodeDragStop={nodeDragStop}
        onSelectionChange={selectionChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDoubleClick={onDoubleClick}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        deleteKeyCode={null}
        minZoom={0.15}
        maxZoom={2.5}
        fitView={!nodes.length ? undefined : false}
        proOptions={{ hideAttribution: true }}
        onMove={(_, vp) => saveViewport({ x: vp.x, y: vp.y, zoom: vp.zoom })}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color="#232936" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => {
            const row = (n.data as CanvasNodeData)?.row;
            return row ? TYPE_COLOR[row.type] : '#444';
          }}
        />
        <Panel position="top-center">
          <HintBar />
        </Panel>
      </ReactFlow>

      {menu && (
        <div className="fixed z-50 w-56 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          <div className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-slate-500">Создать узел</div>
          {(Object.keys(NODE_TYPE_META) as Array<keyof typeof NODE_TYPE_META>).map((t) => (
            <button
              key={t}
              onClick={() => {
                void useStore.getState().addNode(t, { x: Math.round(menu.flowX), y: Math.round(menu.flowY) });
                setMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
            >
              <span>{NODE_TYPE_META[t].icon}</span> {NODE_TYPE_META[t].label}
            </button>
          ))}
        </div>
      )}

      {edgeMenu && (
        <div className="fixed z-50 w-56 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl" style={{ left: edgeMenu.x, top: edgeMenu.y }}>
          {(['parent', 'related', 'derived'] as EdgeKind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                void changeEdgeKind(edgeMenu.edgeId, k);
                setEdgeMenu(null);
              }}
              className={'block w-full rounded-lg px-2 py-1 text-left text-xs hover:bg-slate-800 ' + (k === edgeMenu.kind ? 'text-indigo-300' : 'text-slate-300')}
            >
              {k === 'parent' ? '→ родитель → потомок' : k === 'related' ? '· · · связаны' : '⇢ выведен из'}
            </button>
          ))}
          <button
            onClick={() => {
              void removeEdge(edgeMenu.edgeId);
              setEdgeMenu(null);
            }}
            className="mt-1 block w-full rounded-lg border-t border-slate-800 px-2 py-1 text-left text-xs text-red-400 hover:bg-slate-800"
          >
            ✕ Удалить связь
          </button>
        </div>
      )}

      {branchNode && <BranchDialog parentNode={branchNode} onClose={() => setBranchSource(null)} />}
    </>
  );
}

function HintBar() {
  const multiCount = useStore((s) => s.multiSelected.length);
  const synthesize = useStore((s) => s.synthesize);
  const nodes = useStore((s) => s.nodes);
  const [busy, setBusy] = useState(false);
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/85 px-3 py-1 text-[11px] text-slate-400 shadow backdrop-blur">
      ПКМ по холсту — новый узел · тяните за точки для связи · Shift+рамка — мультивыбор · Enter — открыть диалог
      {multiCount >= 2 && (
        <button
          disabled={busy}
          onClick={async () => {
            const ids = useStore.getState().multiSelected.filter((id) => !nodes.some((n) => n.id === id && n.type === 'summary'));
            if (ids.length < 2) return;
            setBusy(true);
            await synthesize(ids);
            setBusy(false);
          }}
          className="rounded-full bg-violet-600 px-2.5 py-0.5 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {busy ? 'Синтез…' : `✨ Синтезировать (${multiCount})`}
        </button>
      )}
    </div>
  );
}

export { toFlowNode, toFlowEdge };
