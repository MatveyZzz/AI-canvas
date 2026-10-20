import { nanoid } from 'nanoid';
import { getDb } from './index.js';

// ---------- Types shared with routes ----------
export type NodeType = 'aiChat' | 'note' | 'idea' | 'summary' | 'task';
export type EdgeKind = 'parent' | 'related' | 'derived';
export type ContextMode = 'current' | 'parent' | 'selected' | 'workspace';

export interface NodeRow {
  id: string;
  workspace_id: string;
  type: NodeType;
  title: string;
  x: number; y: number; width: number; height: number;
  content: string;
  model: string;
  temperature: number;
  parent_node_id: string | null;
  origin: string | null;
  context_mode: ContextMode;
  context_nodes: string;
  collapsed: number;
  hidden: number;
  status: string;
  created_at: string; updated_at: string;
}

export interface MessageRow {
  id: string; node_id: string; role: 'user' | 'assistant';
  content: string; pending: number; tokens: number | null; created_at: string;
}

export interface EdgeRow {
  id: string; workspace_id: string; source: string; target: string; kind: EdgeKind; created_at: string;
}

const json = (v: unknown) => JSON.stringify(v);

// ---------- Workspace ----------
export function createWorkspace(title: string) {
  const id = nanoid(12);
  getDb()
    .prepare('INSERT INTO workspaces (id, title) VALUES (?, ?)')
    .run(id, title);
  return getWorkspace(id)!;
}

export function getWorkspace(id: string) {
  const ws = getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
    | { id: string; title: string; viewport: string; created_at: string; updated_at: string }
    | undefined;
  if (!ws) return null;
  const nodes = listNodes(id);
  const edges = listEdges(id);
  const messagesByNode: Record<string, MessageRow[]> = {};
  for (const n of nodes) {
    if (n.type === 'aiChat') messagesByNode[n.id] = listMessages(n.id);
  }
  return { ...ws, viewport: JSON.parse(ws.viewport), nodes, edges, messagesByNode };
}

export function listWorkspaces() {
  return getDb().prepare('SELECT id, title, created_at, updated_at FROM workspaces ORDER BY updated_at DESC').all();
}

export function updateWorkspace(id: string, patch: { title?: string; viewport?: unknown }) {
  const sets: string[] = [], args: unknown[] = [];
  if (patch.title !== undefined) { sets.push('title = ?'); args.push(patch.title); }
  if (patch.viewport !== undefined) { sets.push('viewport = ?'); args.push(json(patch.viewport)); }
  if (!sets.length) return;
  args.push(id);
  getDb().prepare(`UPDATE workspaces SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args);
}

export function deleteWorkspace(id: string) {
  getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id);
}

// ---------- Nodes ----------
export function listNodes(workspaceId: string): NodeRow[] {
  return getDb().prepare('SELECT * FROM nodes WHERE workspace_id = ?').all(workspaceId) as NodeRow[];
}

export function getNode(id: string): NodeRow | null {
  return (getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow) ?? null;
}

export interface NodeInput {
  workspace_id: string;
  type: NodeType;
  title?: string;
  x?: number; y?: number; width?: number; height?: number;
  content?: string;
  model?: string;
  temperature?: number;
  parent_node_id?: string | null;
  origin?: unknown;
  context_mode?: ContextMode;
  context_nodes?: string[];
  collapsed?: boolean;
}

export function createNode(input: NodeInput): NodeRow {
  const id = nanoid(12);
  getDb()
    .prepare(
      `INSERT INTO nodes (id, workspace_id, type, title, x, y, width, height, content, model, temperature,
        parent_node_id, origin, context_mode, context_nodes, collapsed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id, input.workspace_id, input.type, input.title ?? '',
      input.x ?? 0, input.y ?? 0, input.width ?? 360, input.height ?? 260,
      input.content ?? '', input.model ?? 'deepseek-chat', input.temperature ?? 0.7,
      input.parent_node_id ?? null, input.origin === undefined ? null : json(input.origin),
      input.context_mode ?? 'current', json(input.context_nodes ?? []), input.collapsed ? 1 : 0
    );
  return getNode(id)!;
}

const NODE_UPDATABLE = [
  'type', 'title', 'x', 'y', 'width', 'height', 'content', 'model', 'temperature',
  'parent_node_id', 'origin', 'context_mode', 'context_nodes', 'collapsed', 'hidden', 'status',
] as const;

export function updateNode(id: string, patch: Partial<Record<(typeof NODE_UPDATABLE)[number], unknown>>): NodeRow | null {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const key of NODE_UPDATABLE) {
    if (!(key in patch)) continue;
    let v = (patch as Record<string, unknown>)[key];
    if (key === 'origin') v = v == null ? null : json(v);
    if (key === 'context_nodes' && Array.isArray(v)) v = json(v);
    if (key === 'collapsed' || key === 'hidden') v = v ? 1 : 0;
    sets.push(`${key} = ?`);
    args.push(v as never);
  }
  if (!sets.length) return getNode(id);
  args.push(id);
  getDb().prepare(`UPDATE nodes SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args);
  return getNode(id);
}

export function deleteNode(id: string) {
  // ON DELETE CASCADE removes messages and edges referencing this node;
  // child nodes keep existing but their parent_node_id is set to NULL by FK.
  getDb().prepare('DELETE FROM nodes WHERE id = ?').run(id);
}

// ---------- Messages ----------
export function listMessages(nodeId: string): MessageRow[] {
  return getDb().prepare('SELECT * FROM messages WHERE node_id = ? ORDER BY created_at, rowid').all(nodeId) as MessageRow[];
}

export function addMessage(nodeId: string, role: 'user' | 'assistant', content: string, opts?: { pending?: boolean; tokens?: number | null }): MessageRow {
  const id = nanoid(12);
  getDb()
    .prepare('INSERT INTO messages (id, node_id, role, content, pending, tokens) VALUES (?,?,?,?,?,?)')
    .run(id, nodeId, role, content, opts?.pending ? 1 : 0, opts?.tokens ?? null);
  return getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow;
}

export function updateMessage(id: string, patch: { content?: string; pending?: boolean; tokens?: number | null }) {
  const sets: string[] = [], args: unknown[] = [];
  if (patch.content !== undefined) { sets.push('content = ?'); args.push(patch.content); }
  if (patch.pending !== undefined) { sets.push('pending = ?'); args.push(patch.pending ? 1 : 0); }
  if (patch.tokens !== undefined) { sets.push('tokens = ?'); args.push(patch.tokens); }
  if (!sets.length) return;
  args.push(id);
  getDb().prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

export function deleteMessage(id: string) {
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
}

// ---------- Edges ----------
export function listEdges(workspaceId: string): EdgeRow[] {
  return getDb().prepare('SELECT * FROM edges WHERE workspace_id = ?').all(workspaceId) as EdgeRow[];
}

export function createEdge(workspaceId: string, source: string, target: string, kind: EdgeKind): EdgeRow {
  // Avoid duplicate connections between the same pair.
  const existing = getDb()
    .prepare('SELECT * FROM edges WHERE source = ? AND target = ?')
    .get(source, target) as EdgeRow | undefined;
  if (existing) return existing;
  const id = nanoid(12);
  getDb()
    .prepare('INSERT INTO edges (id, workspace_id, source, target, kind) VALUES (?,?,?,?,?)')
    .run(id, workspaceId, source, target, kind);
  return getDb().prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow;
}

export function updateEdge(id: string, kind: EdgeKind) {
  getDb().prepare('UPDATE edges SET kind = ? WHERE id = ?').run(kind, id);
}

export function deleteEdge(id: string) {
  getDb().prepare('DELETE FROM edges WHERE id = ?').run(id);
}
