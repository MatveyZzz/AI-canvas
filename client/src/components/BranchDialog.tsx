import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { ContextMode, MessageRow, NodeRow } from '../lib/types';
import { CONTEXT_MODE_LABEL } from '../lib/types';

// Branch creation dialog: creates a child AI Chat node with chosen context mode.
// The parent history is never modified — branching only copies context.
export function BranchDialog({
  parentNode,
  sourceMessage,
  initialFragment,
  onClose,
}: {
  parentNode: NodeRow;
  sourceMessage?: MessageRow | null;
  initialFragment?: string;
  onClose: () => void;
}) {
  const branchFromNode = useStore((s) => s.branchFromNode);
  const [mode, setMode] = useState<ContextMode>(sourceMessage ? 'parent' : 'current');
  const [prompt, setPrompt] = useState(initialFragment ? `Развей эту мысль: «${initialFragment}»` : '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await branchFromNode(parentNode.id, {
      mode,
      prompt,
      title: prompt.trim() ? prompt.trim().slice(0, 40) : undefined,
      origin: { messageId: sourceMessage?.id, fragment: initialFragment || undefined },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div
        className="w-[480px] max-w-[92vw] rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-sm font-semibold text-slate-100">Новая ветка от узла «{parentNode.title || 'без названия'}»</div>
        <div className="mb-3 text-xs text-slate-400">
          История родителя останется неизменной. Ветка получит контекст в выбранном режиме
          {sourceMessage ? ' и ссылку на исходное сообщение' : ''}.
        </div>

        <label className="mb-1 block text-xs font-medium text-slate-300">Контекст ветки</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ContextMode)}
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
        >
          {(['current', 'parent', 'selected', 'workspace'] as ContextMode[]).map((m) => (
            <option key={m} value={m}>
              {CONTEXT_MODE_LABEL[m]}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-slate-300">Первый вопрос в ветке (необязательно)</label>
        <textarea
          autoFocus
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="Например: а что если посмотреть на это с точки зрения стоимости?"
          className="mb-3 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm outline-none placeholder:text-slate-500 focus:border-indigo-500"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Отмена
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Создание…' : 'Создать ветку'}
          </button>
        </div>
      </div>
    </div>
  );
}
