import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { ChatView } from './ChatView';
import { NODE_TYPE_META } from '../lib/types';

// Full-screen dialog for a node (Enter on canvas opens it for the selected node).
export function NodeDialog() {
  const expandedId = useStore((s) => s.expandedNodeId);
  const node = useStore((s) => s.nodes.find((n) => n.id === expandedId));
  const setExpanded = useStore((s) => s.setExpanded);
  const commitNodePatch = useStore((s) => s.commitNodePatch);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setExpanded]);

  useEffect(() => {
    if (node && node.type !== 'aiChat' && ref.current) ref.current.focus();
  }, [node?.id]); // eslint-disable-line

  if (!expandedId || !node) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setExpanded(null)}>
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
          <span>{NODE_TYPE_META[node.type].icon}</span>
          <input
            value={node.title}
            onChange={(e) => commitNodePatch(node.id, { title: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 outline-none"
            placeholder="Название узла"
          />
          <button onClick={() => setExpanded(null)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800" title="Закрыть (Esc)">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {node.type === 'aiChat' ? (
            <ChatView node={node} />
          ) : node.type === 'task' ? (
            <TaskFull node={node} />
          ) : (
            <textarea
              ref={ref}
              defaultValue={node.content}
              key={node.id + node.updated_at}
              onBlur={(e) => {
                if (e.target.value !== node.content) void commitNodePatch(node.id, { content: e.target.value });
              }}
              className="h-full w-full resize-none bg-transparent p-4 text-sm leading-relaxed text-slate-200 outline-none"
              placeholder={node.type === 'summary' ? 'Текст сводки…' : 'Текст…'}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TaskFull({ node }: { node: ReturnType<typeof useStore.getState>['nodes'][number] }) {
  const commit = useStore((s) => s.commitNodePatch);
  const lines = node.content.split('\n').filter((l) => l.trim());
  const tasks = lines.map((l) => ({ done: /^\[x\]/i.test(l), text: l.replace(/^\[( |x)\]\s?/i, '') }));
  const save = (next: { done: boolean; text: string }[]) =>
    void commit(node.id, { content: next.filter((t) => t.text.trim()).map((t) => `[${t.done ? 'x' : ' '}] ${t.text}`).join('\n') });
  return (
    <div className="p-4">
      {tasks.map((t, i) => (
        <label key={i} className="mb-1.5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={t.done} onChange={(e) => { const n = [...tasks]; n[i] = { ...n[i], done: e.target.checked }; save(n); }} />
          <input
            defaultValue={t.text}
            onBlur={(e) => { const n = [...tasks]; n[i] = { ...n[i], text: e.target.value }; save(n); }}
            className={'flex-1 bg-transparent outline-none ' + (t.done ? 'text-slate-500 line-through' : 'text-slate-200')}
          />
        </label>
      ))}
      <button
        onClick={() => save([...tasks, { done: false, text: '' }])}
        className="mt-2 rounded-lg border border-dashed border-slate-600 px-3 py-1 text-xs text-slate-400 hover:border-slate-400"
      >
        + добавить задачу
      </button>
    </div>
  );
}
