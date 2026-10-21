import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStore } from '../store/useStore';
import { ChatView } from './ChatView';
import { BranchDialog } from './BranchDialog';
import { Markdown } from './Markdown';
import type { NodeRow, NodeType } from '../lib/types';
import { NODE_TYPE_META, parseOrigin } from '../lib/types';

export interface CanvasNodeData {
  row: NodeRow;
  [key: string]: unknown;
}

const TYPE_COLOR: Record<NodeType, string> = {
  aiChat: '#6366f1',
  note: '#0ea5e9',
  idea: '#f59e0b',
  summary: '#8b5cf6',
  task: '#22c55e',
};

// Lightweight debounce-synced editable textarea (local state -> server on pause).
function Editable({
  value,
  onSave,
  className,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  className: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const lastExternal = useRef(value);
  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      setText(value);
    }
  }, [value]);
  return (
    <textarea
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onSave(text);
      }}
      className={className}
    />
  );
}

function TaskEditor({ raw, onSave }: { raw: string; onSave: (v: string) => void }) {
  const lines = raw.split('\n');
  const tasks = lines.map((l) => ({ done: l.startsWith('[x]'), text: l.replace(/^\[( |x)\]\s?/, '') }));
  const setTasks = (next: { done: boolean; text: string }[]) => onSave(next.map((t) => `[${t.done ? 'x' : ' '}] ${t.text}`).join('\n'));
  return (
    <div className="nodrag flex flex-col gap-0.5 px-2 py-1">
      {tasks.length === 0 && <div className="text-[11px] text-slate-500">Новая задача…</div>}
      {tasks.map((t, i) => (
        <label key={i} className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={t.done}
            onChange={(e) => {
              const next = [...tasks];
              next[i] = { ...next[i], done: e.target.checked };
              setTasks(next);
            }}
          />
          <input
            value={t.text}
            onChange={(e) => {
              const next = [...tasks];
              next[i] = { ...next[i], text: e.target.value };
              setTasks(next);
            }}
            onBlur={() => {
              const cleaned = tasks.filter((x) => x.text.trim() !== '');
              if (cleaned.length !== tasks.length) setTasks(cleaned);
            }}
            className={'flex-1 bg-transparent outline-none ' + (t.done ? 'text-slate-500 line-through' : 'text-slate-200')}
            placeholder="задача"
          />
        </label>
      ))}
      <button
        onClick={() => setTasks([...tasks, { done: false, text: '' }])}
        className="nodrag mt-0.5 self-start rounded border border-dashed border-slate-700 px-1.5 text-[10px] text-slate-400 hover:border-slate-500"
      >
        + пункт
      </button>
    </div>
  );
}

export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps) {
  const row = (data as CanvasNodeData).row;
  const generating = useStore((s) => !!s.generating[row.id]);
  const commitNodePatch = useStore((s) => s.commitNodePatch);
  const patchNodeLocal = useStore((s) => s.patchNodeLocal);
  const removeNode = useStore((s) => s.removeNode);
  const makeSummary = useStore((s) => s.makeSummary);
  const setExpanded = useStore((s) => s.setExpanded);
  const multiSelected = useStore((s) => s.multiSelected.includes(row.id));
  const origin = parseOrigin(row);

  const [branchOpen, setBranchOpen] = useState(false);
  const color = TYPE_COLOR[row.type];
  const collapsed = row.collapsed === 1;
  const isChat = row.type === 'aiChat';

  return (
    <div
      className={
        'relative h-full w-full overflow-hidden rounded-xl border bg-slate-900/95 shadow-lg transition-colors ' +
        (selected ? 'border-indigo-500' : 'border-slate-700') +
        (generating ? ' ring-1 ring-indigo-500/60' : '')
      }
      style={{ boxShadow: selected ? `0 0 0 1px ${color}55, 0 8px 30px rgba(0,0,0,.45)` : undefined }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} id="right-src" />
      <Handle type="target" position={Position.Left} id="left-tgt" />

      {/* header */}
      <div
        className="flex h-8 cursor-grab items-center gap-1.5 border-b border-slate-800 px-2"
        style={{ background: `${color}14` }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setExpanded(row.id);
        }}
      >
        <span className="text-xs">{NODE_TYPE_META[row.type].icon}</span>
        <Editable
          value={row.title}
          onSave={(v) => void commitNodePatch(row.id, { title: v })}
          className="nodrag min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-slate-100 outline-none"
          placeholder="Название узла"
        />
        {generating && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-indigo-400" />}
        {multiSelected && <span className="shrink-0 rounded bg-indigo-600 px-1 text-[9px] font-bold text-white">✓</span>}
        <button
          title={collapsed ? 'Развернуть на холсте' : 'Свернуть'}
          onClick={() => void commitNodePatch(row.id, { collapsed: collapsed ? 0 : 1 })}
          className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-800"
        >
          {collapsed ? '⊞' : '⊟'}
        </button>
        <button title="Открыть диалог (Enter при выбранном узле)" onClick={() => setExpanded(row.id)} className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-800">
          ⤢
        </button>
        <button title="Удалить узел" onClick={() => void removeNode(row.id)} className="shrink-0 rounded px-1 text-slate-500 hover:bg-red-950 hover:text-red-400">
          ✕
        </button>
      </div>

      {/* body */}
      {!collapsed && isChat && (
        <div className="h-[calc(100%-2rem)]">
          <ChatView node={row} compact />
        </div>
      )}
      {!collapsed && row.type === 'note' && (
        <Editable
          value={row.content}
          onSave={(v) => {
            patchNodeLocal(row.id, { content: v });
            void commitNodePatch(row.id, { content: v });
          }}
          className="nodrag h-[calc(100%-2rem)] w-full resize-none bg-transparent p-2 text-xs leading-relaxed text-slate-200 outline-none placeholder:text-slate-600"
          placeholder="Текст заметки…"
        />
      )}
      {!collapsed && row.type === 'idea' && (
        <div className="flex h-[calc(100%-2rem)] flex-col">
          <Editable
            value={row.content}
            onSave={(v) => void commitNodePatch(row.id, { content: v })}
            className="nodrag min-h-[40%] w-full flex-1 resize-none bg-transparent p-2 text-xs italic leading-relaxed text-amber-100/90 outline-none placeholder:text-slate-600"
            placeholder="Идея, гипотеза, вопрос…"
          />
          <div className="border-t border-slate-800 p-1.5">
            <button
              onClick={() => setBranchOpen(true)}
              className="nodrag w-full rounded border border-indigo-800/70 bg-indigo-950/40 px-2 py-1 text-[10px] text-indigo-300 hover:bg-indigo-900/40"
            >
              ↪ Развить идею с помощью AI (новая ветка)
            </button>
          </div>
        </div>
      )}
      {!collapsed && row.type === 'summary' && (
        <div className="nodrag h-[calc(100%-2rem)] overflow-y-auto p-2 text-xs text-slate-200">
          <Markdown text={row.content || '_Пустая сводка_'} />
          {origin?.summaryOf && (
            <div className="mt-2 text-[10px] text-slate-500">сводка по узлу «{useStore.getState().nodes.find((n) => n.id === origin.summaryOf)?.title ?? '?'}»</div>
          )}
        </div>
      )}
      {!collapsed && row.type === 'task' && <TaskEditor raw={row.content} onSave={(v) => void commitNodePatch(row.id, { content: v })} />}

      {collapsed && (
        <div className="p-2 text-[10px] text-slate-500">
          {isChat ? `${(useStore.getState().messagesByNode[row.id] ?? []).length} сообщ.` : row.content.slice(0, 80) || '—'}
          {origin?.fragment ? ` · фрагмент: «${origin.fragment.slice(0, 40)}…»` : ''}
        </div>
      )}

      {/* quick actions for chat nodes */}
      {!collapsed && isChat && (
        <div className="pointer-events-none absolute bottom-1 right-1 flex gap-1">
          <button
            onClick={() => void makeSummary(row.id)}
            className="pointer-events-auto nodrag rounded border border-slate-700 bg-slate-900/90 px-1.5 py-0.5 text-[9px] text-slate-400 hover:text-slate-200"
            title="Локальная сводка последних сообщений"
          >
            🗂
          </button>
          <button
            onClick={() => setBranchOpen(true)}
            className="pointer-events-auto nodrag rounded border border-slate-700 bg-slate-900/90 px-1.5 py-0.5 text-[9px] text-slate-400 hover:text-slate-200"
            title="Создать ветку от этого узла"
          >
            ↪
          </button>
        </div>
      )}

      {branchOpen && <BranchDialog parentNode={row} onClose={() => setBranchOpen(false)} />}
    </div>
  );
});

export { TYPE_COLOR };
