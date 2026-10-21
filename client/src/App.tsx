import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useStore } from './store/useStore';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { NodeDialog } from './components/NodeDialog';

export default function App() {
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const loadError = useStore((s) => s.loadError);
  const serverDown = useStore((s) => s.serverDown);
  const health = useStore((s) => s.health);
  const workspaceId = useStore((s) => s.workspaceId);
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setExpanded = useStore((s) => s.setExpanded);

  useEffect(() => {
    void init();
  }, [init]);

  // Global shortcuts: Ctrl+Z / Ctrl+Shift+Z, Enter opens dialog of selected node.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      }
      if (e.key === 'Enter' && !typing) {
        const id = useStore.getState().selectedNodeId;
        if (id) setExpanded(id);
      }
      if (e.key === 'Escape') {
        setExpanded(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setExpanded]);

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-slate-800 bg-[#10131a] px-3">
        <span className="text-sm font-semibold tracking-wide text-slate-100">🧠 AI Canvas</span>
        <WorkspaceTitle />
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {serverDown ? (
            <span className="rounded-full border border-red-800 bg-red-950/60 px-2 py-0.5 text-red-300" title="Запустите backend: cd server && npm run dev">
              ● сервер выключен
            </span>
          ) : health?.configured ? (
            <span className="rounded-full border border-emerald-900 bg-emerald-950/50 px-2 py-0.5 text-emerald-300" title={health.models.join(', ')}>
              ● {health.provider} готов
            </span>
          ) : (
            <span className="rounded-full border border-amber-800 bg-amber-950/50 px-2 py-0.5 text-amber-300" title={health?.hint ?? ''}>
              ● API-ключ не задан
            </span>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Загрузка…</div>
          ) : loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="text-4xl">🔌</div>
              <div className="max-w-md text-sm text-slate-300">{loadError}</div>
              <ol className="max-w-md text-left text-xs leading-6 text-slate-500">
                <li>1. Терминал A: <code className="rounded bg-slate-800 px-1">cd server && npm run dev</code></li>
                <li>2. Скопируйте <code className="rounded bg-slate-800 px-1">server/.env.example → server/.env</code> и впишите DEEPSEEK_API_KEY</li>
                <li>3. Обновите эту страницу</li>
              </ol>
              <button onClick={() => void useStore.getState().init()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">
                Попробовать снова
              </button>
            </div>
          ) : !workspaceId ? (
            <NewWorkspace />
          ) : (
            <ReactFlowProvider>
              <Canvas />
            </ReactFlowProvider>
          )}
        </main>
        <NodeDialog />
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-2 text-xs text-slate-200 shadow-2xl" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

function WorkspaceTitle() {
  const title = useStore((s) => s.workspaceTitle);
  const rename = useStore((s) => s.renameWorkspace);
  return workspaceHasData() ? (
    <input
      defaultValue={title}
      key={title}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== title) rename(v);
      }}
      className="w-52 rounded px-1.5 py-0.5 text-xs text-slate-400 outline-none hover:bg-slate-800 focus:bg-slate-800"
    />
  ) : null;
}
function workspaceHasData() {
  return !!useStore.getState().workspaceId;
}

function NewWorkspace() {
  const createWorkspace = useStore((s) => s.createWorkspace);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="text-5xl">🗺</div>
      <h1 className="text-lg font-semibold text-slate-100">Добро пожаловать в AI Canvas</h1>
      <p className="max-w-md text-center text-xs leading-5 text-slate-400">
        Пространство мыслей: бесконечный холст с узлами — заметки, идеи, задачи и AI-диалоги (DeepSeek).
        Любую ветку диалога можно продлить без изменения исходной истории, а связанные узлы — синтезировать в новые.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget.elements.namedItem('title') as HTMLInputElement;
          void createWorkspace(f.value.trim() || 'Моё пространство');
        }}
      >
        <input
          name="title"
          placeholder="Название пространства"
          className="w-64 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Создать</button>
      </form>
    </div>
  );
}
