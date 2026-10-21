import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { NODE_TYPE_META, type NodeType } from '../lib/types';

export function Sidebar() {
  const workspaceId = useStore((s) => s.workspaceId);
  const workspacesList = useStore((s) => s.workspacesList);
  const nodes = useStore((s) => s.nodes);
  const search = useStore((s) => s.searchQuery);
  const typeFilter = useStore((s) => s.typeFilter);
  const messagesByNode = useStore((s) => s.messagesByNode);
  const edges = useStore((s) => s.edges);
  const openWorkspace = useStore((s) => s.openWorkspace);
  const createWorkspace = useStore((s) => s.createWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const setExpanded = useStore((s) => s.setExpanded);
  const hideNode = useStore((s) => s.hideNode);
  const setSearch = useStore((s) => s.setSearch);
  const setTypeFilter = useStore((s) => s.setTypeFilter);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const addNode = useStore((s) => s.addNode);

  const [newWs, setNewWs] = useState('');
  const [showAllWs, setShowAllWs] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes
      .filter((n) => (showHidden ? true : n.hidden === 0))
      .filter((n) => (typeFilter === 'all' ? true : n.type === typeFilter))
      .filter((n) => {
        if (!q) return true;
        const hay = (n.title + ' ' + n.content + ' ' + (messagesByNode[n.id] ?? []).map((m) => m.content).join(' ')).toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [nodes, search, typeFilter, messagesByNode, showHidden]);

  if (!sidebarOpen) {
    return (
      <button
        onClick={() => toggleSidebar(true)}
        className="absolute left-2 top-12 z-30 rounded-lg border border-slate-700 bg-slate-900/90 px-2 py-1 text-xs text-slate-300 shadow hover:bg-slate-800"
        title="Показать панель"
      >
        ☰
      </button>
    );
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-800 bg-[#10131a]">
      {/* workspace switcher */}
      <div className="border-b border-slate-800 p-2">
        <button
          onClick={() => setShowAllWs((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-left text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <span className="truncate">🗺 {useStore.getState().workspaceTitle || 'Пространство'}</span>
          <span className="text-slate-500">{showAllWs ? '▴' : '▾'}</span>
        </button>
        {showAllWs && (
          <div className="mt-1 rounded-lg border border-slate-700 bg-slate-900 p-1">
            {workspacesList.map((w) => (
              <div key={w.id} className={'group flex items-center gap-1 rounded ' + (w.id === workspaceId ? 'bg-slate-800' : '')}>
                <button onClick={() => void openWorkspace(w.id)} className="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-xs text-slate-300 hover:text-white">
                  {w.title}
                </button>
                <button onClick={() => void deleteWorkspace(w.id)} className="hidden px-1 text-xs text-red-400 group-hover:block" title="Удалить пространство">
                  ✕
                </button>
              </div>
            ))}
            <form
              className="mt-1 flex gap-1 border-t border-slate-800 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newWs.trim()) {
                  void createWorkspace(newWs.trim());
                  setNewWs('');
                }
              }}
            >
              <input
                value={newWs}
                onChange={(e) => setNewWs(e.target.value)}
                placeholder="Новое пространство…"
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs outline-none focus:border-indigo-500"
              />
              <button className="rounded bg-indigo-600 px-2 text-xs text-white hover:bg-indigo-500">+</button>
            </form>
          </div>
        )}
      </div>

      {/* quick add */}
      <div className="border-b border-slate-800 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Быстрое создание</div>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(NODE_TYPE_META) as NodeType[]).map((t) => (
            <button
              key={t}
              disabled={!workspaceId}
              onClick={() => {
                const jitter = () => Math.round(Math.random() * 160 - 80);
                void addNode(t, { x: 120 + jitter(), y: 120 + jitter() });
              }}
              className="rounded-lg border border-slate-700 bg-slate-800/50 px-1.5 py-1 text-left text-[11px] text-slate-300 hover:border-indigo-600 hover:bg-slate-800 disabled:opacity-40"
            >
              {NODE_TYPE_META[t].icon} {NODE_TYPE_META[t].label}
            </button>
          ))}
        </div>
      </div>

      {/* search & filter */}
      <div className="space-y-1 border-b border-slate-800 p-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Поиск по всем узлам…"
          className="w-full rounded-lg border border-slate-700 bg-slate-800/70 px-2 py-1.5 text-xs outline-none placeholder:text-slate-500 focus:border-indigo-500"
        />
        <div className="flex flex-wrap gap-1">
          <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} label="Все" />
          {(Object.keys(NODE_TYPE_META) as NodeType[]).map((t) => (
            <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)} label={NODE_TYPE_META[t].icon} title={NODE_TYPE_META[t].label} />
          ))}
        </div>
      </div>

      {/* node list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {filtered.length === 0 && <div className="p-3 text-center text-xs text-slate-600">{workspaceId ? 'Ничего не найдено' : 'Создайте рабочее пространство'}</div>}
        {filtered.map((n) => {
          const msgCount = (messagesByNode[n.id] ?? []).length;
          const linkCount = edges.filter((e) => e.source === n.id || e.target === n.id).length;
          const preview = (n.content || (messagesByNode[n.id] ?? []).at(-1)?.content || '').replace(/[#*`>]/g, '').slice(0, 70);
          return (
            <div key={n.id} className="group mb-0.5 rounded-lg px-2 py-1.5 hover:bg-slate-800/70">
              <button onClick={() => setExpanded(n.id)} className="block w-full text-left">
                <div className="flex items-center gap-1.5 text-xs text-slate-200">
                  <span>{NODE_TYPE_META[n.type].icon}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{n.title || '(без названия)'}</span>
                  {n.status === 'error' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  {n.hidden === 1 && <span className="text-[9px] text-slate-500">скрыт</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                  {preview && <span className="min-w-0 flex-1 truncate">{preview}</span>}
                  {msgCount > 0 && <span className="shrink-0">{msgCount} сообщ.</span>}
                  {linkCount > 0 && <span className="shrink-0">· 🔗{linkCount}</span>}
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void hideNode(n.id, n.hidden !== 1);
                }}
                className="float-right text-[10px] text-slate-600 hover:text-slate-300"
                title={n.hidden ? 'Показать на холсте' : 'Скрыть с холста (узел остаётся в поиске)'}
              >
                {n.hidden ? '👁' : '🚫'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 px-2 py-1.5 text-[10px] text-slate-500">
        <label className="inline-flex cursor-pointer items-center gap-1">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="size-3" />
          показывать скрытые
        </label>
        <button onClick={() => toggleSidebar(false)} className="rounded px-1 hover:bg-slate-800" title="Свернуть панель">
          ◀
        </button>
      </div>
    </aside>
  );
}

function FilterChip({ active, onClick, label, title }: { active: boolean; onClick: () => void; label: string; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={'rounded-full border px-2 py-0.5 text-[10px] ' + (active ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200' : 'border-slate-700 text-slate-400 hover:border-slate-500')}
    >
      {label}
    </button>
  );
}
