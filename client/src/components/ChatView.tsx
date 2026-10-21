import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { Markdown } from './Markdown';
import { BranchDialog } from './BranchDialog';
import type { ContextMode, MessageRow, NodeRow } from '../lib/types';
import { CONTEXT_MODE_LABEL, NODE_TYPE_META, parseContextNodes, parseOrigin } from '../lib/types';

const MODES: ContextMode[] = ['current', 'parent', 'selected', 'workspace'];

export function ChatView({ node, compact = false }: { node: NodeRow; compact?: boolean }) {
  const messages = useStore((s) => s.messagesByNode[node.id]);
  const generating = useStore((s) => !!s.generating[node.id]);
  const streaming = useStore((s) => s.streamingText[node.id]);
  const ctx = useStore((s) => s.contextInfo[node.id]);
  const genError = useStore((s) => s.genError[node.id]);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const sendMessage = useStore((s) => s.sendMessage);
  const regenerate = useStore((s) => s.regenerate);
  const stopGeneration = useStore((s) => s.stopGeneration);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const commitNodePatch = useStore((s) => s.commitNodePatch);
  const makeSummary = useStore((s) => s.makeSummary);
  const health = useStore((s) => s.health);

  const [draft, setDraft] = useState('');
  const [branchFor, setBranchFor] = useState<{ msg: MessageRow | null; fragment?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, generating]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const send = () => {
    const t = draft.trim();
    if (!t || generating) return;
    setDraft('');
    stickToBottom.current = true;
    void sendMessage(node.id, t);
  };

  const selectedIds = parseContextNodes(node);
  const parentEdge = edges.find((e) => e.target === node.id && e.kind === 'parent');
  const parentNode = parentEdge ? nodes.find((n) => n.id === parentEdge.source) : null;
  const origin = parseOrigin(node);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* context bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          {NODE_TYPE_META[node.type].icon}
          <b className="font-medium text-slate-300">{node.title || 'Без названия'}</b>
        </span>
        {parentNode && (
          <span title={origin?.fragment ? `Фрагмент: ${origin.fragment}` : undefined}>
            ↩ ветка от «{parentNode.title || 'узла'}»
          </span>
        )}
        <label className="ml-auto inline-flex items-center gap-1">
          Контекст:
          <select
            value={node.context_mode}
            onChange={(e) => void commitNodePatch(node.id, { context_mode: e.target.value as ContextMode })}
            className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[11px]"
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {CONTEXT_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {node.context_mode === 'selected' && (
          <span title={`Узлы: ${selectedIds.join(', ')}`}>выбрано узлов: {selectedIds.length}</span>
        )}
        <select
          value={node.model}
          onChange={(e) => void commitNodePatch(node.id, { model: e.target.value })}
          className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[11px]"
        >
          {(health?.models?.length ? health.models : [node.model]).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {!compact && messages.length > 0 && (
          <button onClick={() => void makeSummary(node.id)} className="rounded px-1.5 py-0.5 hover:bg-slate-800" title="Создать узел-сводку без обращения к API">
            🗂 Сводка
          </button>
        )}
      </div>

      {node.context_mode === 'selected' && (
        <SelectedNodesPicker nodeId={node.id} />
      )}

      {/* messages */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 && !generating && (
          <div className="mt-6 text-center text-xs text-slate-500">
            Задайте вопрос. Ответы можно выделять мышью и уносить в отдельные ветки.
          </div>
        )}
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            msg={m}
            isStreamingTail={false}
            onDelete={() => void deleteMessage(node.id, m.id)}
            onBranch={() => setBranchFor({ msg: m })}
          />
        ))}
        {generating && (
          <div className="mb-3 rounded-lg border border-indigo-900/60 bg-indigo-950/30 p-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px] text-indigo-300">
              <span className="inline-flex items-center gap-1">
                ассистент печатает
                <span className="typing-dot">•</span>
                <span className="typing-dot">•</span>
                <span className="typing-dot">•</span>
              </span>
              <button onClick={() => stopGeneration(node.id)} className="rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 hover:bg-slate-800">
                ⏹ Стоп
              </button>
            </div>
            {streaming ? (
              <Selectable onBranchFragment={(f) => setBranchFor({ msg: null, fragment: f })}>
                <Markdown text={streaming + ' ▍'} />
              </Selectable>
            ) : (
              <div className="text-xs text-slate-500">ожидание первого токена…</div>
            )}
          </div>
        )}
        {genError && !generating && (
          <div className="mb-3 rounded-lg border border-red-900/70 bg-red-950/40 p-2.5 text-xs text-red-300">
            <div className="whitespace-pre-wrap">{genError}</div>
            {health && !health.configured && health.hint && <div className="mt-1 text-red-400/80">{health.hint}</div>}
            <button onClick={() => void regenerate(node.id)} className="mt-1.5 rounded border border-red-800 px-2 py-0.5 hover:bg-red-900/40">
              Повторить генерацию
            </button>
          </div>
        )}
        {ctx && (
          <div className="mb-2 text-[10px] text-slate-500" title={ctx.sources.map((s) => `${s.kind}: ${s.title}`).join('\n')}>
            контекст ~{ctx.usedTokens.toLocaleString('ru')} токенов{ctx.truncated ? ' · часть сжата системой' : ''}
            {ctx.sources.length > 0 ? ` · источников: ${ctx.sources.length}` : ''}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-slate-800 p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={compact ? 2 : 3}
            placeholder={generating ? 'Идёт генерация…' : 'Вопрос ассистенту — Enter отправить, Shift+Enter новая строка'}
            disabled={generating}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-indigo-500 disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={generating || !draft.trim()}
            className="h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ➤
          </button>
        </div>
      </div>

      {branchFor && (
        <BranchDialog
          parentNode={node}
          sourceMessage={branchFor.msg}
          initialFragment={branchFor.fragment}
          onClose={() => setBranchFor(null)}
        />
      )}
    </div>
  );
}

function Selectable({ children, onBranchFragment }: { children: React.ReactNode; onBranchFragment: (t: string) => void }) {
  return (
    <div
      onMouseUp={() => {
        const sel = window.getSelection();
        const t = sel?.toString().trim() ?? '';
        if (t.length >= 3) onBranchFragment(t);
      }}
    >
      {children}
    </div>
  );
}

function MessageItem({
  msg,
  onDelete,
  onBranch,
}: {
  msg: MessageRow;
  isStreamingTail: boolean;
  onDelete: () => void;
  onBranch: () => void;
}) {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const setExpanded = useStore((s) => s.setExpanded);
  const [menuOpen, setMenuOpen] = useState(false);

  const isUser = msg.role === 'user';
  // Which child branches were created from this message?
  const derived = nodes.filter((n) => parseOrigin(n)?.messageId === msg.id);

  return (
    <div className={'group mb-3 flex ' + (isUser ? 'justify-end' : 'justify-start')}>
      <div className={'max-w-[92%] ' + (isUser ? 'w-fit' : 'w-full')}>
        <div
          className={
            'rounded-lg border px-3 py-2 text-sm ' +
            (isUser
              ? 'border-indigo-800/60 bg-indigo-950/50 text-indigo-100'
              : 'border-slate-800 bg-slate-900/60 text-slate-200')
          }
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          ) : (
            <Selectable onBranchFragment={() => onBranch()}>
              <Markdown text={msg.content || '…'} />
            </Selectable>
          )}
        </div>
        <div className={'mt-0.5 flex items-center gap-1 text-[10px] text-slate-500 ' + (isUser ? 'justify-end' : '')}>
          <span>{new Date(msg.created_at + (msg.created_at.includes('T') ? 'Z' : 'Z')).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
          {msg.tokens != null && <span>· ~{msg.tokens} ток.</span>}
          <div className="relative opacity-0 transition group-hover:opacity-100">
            <button onClick={() => setMenuOpen((v) => !v)} className="rounded px-1 hover:bg-slate-800">⋯</button>
            {menuOpen && (
              <div className="absolute left-0 top-5 z-20 w-52 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl" onMouseLeave={() => setMenuOpen(false)}>
                <button
                  className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800"
                  onClick={() => {
                    setMenuOpen(false);
                    onBranch();
                  }}
                >
                  ↪ Ветка от этого сообщения
                </button>
                <button
                  className="block w-full rounded px-2 py-1 text-left text-xs text-red-400 hover:bg-slate-800"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  ✕ Удалить сообщение
                </button>
              </div>
            )}
          </div>
          {derived.map((d) => (
            <button
              key={d.id}
              onClick={() => setExpanded(d.id)}
              className="rounded border border-emerald-900/70 bg-emerald-950/40 px-1.5 text-[10px] text-emerald-300 hover:bg-emerald-900/40"
              title={edges.some((e) => e.source === d.parent_node_id ?? '' && e.target === d.id) ? 'Контекст передан через связь' : ''}
            >
              ↳ {d.title || 'ветка'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Checkbox picker for 'selected' context mode.
function SelectedNodesPicker({ nodeId }: { nodeId: string }) {
  const nodes = useStore((s) => s.nodes);
  const commit = useStore((s) => s.commitNodePatch);
  const current = useStore((s) => s.nodes.find((n) => n.id === nodeId));
  const ids = current ? parseContextNodes(current) : [];
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    // store as JSON string locally; send parsed array to the server patch
    void commit(nodeId, { context_nodes: JSON.stringify(next), contextNodes: next } as never);
  };
  return (
    <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto border-b border-slate-800 bg-slate-950/60 px-3 py-1.5">
      {nodes
        .filter((n) => n.id !== nodeId && !n.hidden)
        .map((n) => (
          <button
            key={n.id}
            onClick={() => toggle(n.id)}
            className={
              'cursor-pointer rounded-full border px-2 py-0.5 text-[10px] ' +
              (ids.includes(n.id)
                ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                : 'border-slate-700 text-slate-400 hover:border-slate-500')
            }
          >
            {NODE_TYPE_META[n.type].icon} {n.title || n.type}
          </button>
        ))}
      {ids.length === 0 && <span className="text-[10px] text-amber-400/80">Выберите узлы для контекста →</span>}
    </div>
  );
}
