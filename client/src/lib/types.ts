// Shared client types mirroring the server API shapes.

export type NodeType = 'aiChat' | 'note' | 'idea' | 'summary' | 'task';
export type EdgeKind = 'parent' | 'related' | 'derived';
export type ContextMode = 'current' | 'parent' | 'selected' | 'workspace';

export interface NodeRow {
  id: string;
  workspace_id: string;
  type: NodeType;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  model: string;
  temperature: number;
  parent_node_id: string | null;
  origin: string | null; // JSON {messageId?, fragment?, summaryOf?}
  context_mode: ContextMode;
  context_nodes: string; // JSON string[]
  collapsed: number;
  hidden: number;
  status: string; // idle | generating | error
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  node_id: string;
  role: 'user' | 'assistant';
  content: string;
  pending: number;
  tokens: number | null;
  created_at: string;
}

export interface EdgeRow {
  id: string;
  workspace_id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  created_at: string;
}

export interface WorkspaceFull {
  id: string;
  title: string;
  viewport: { x?: number; y?: number; zoom?: number };
  nodes: NodeRow[];
  edges: EdgeRow[];
  messagesByNode: Record<string, MessageRow[]>;
  created_at: string;
  updated_at: string;
}

export interface HealthInfo {
  ok: boolean;
  provider: string;
  configured: boolean;
  hint: string | null;
  models: string[];
}

export interface ContextSource {
  nodeId: string;
  title: string;
  kind: string;
  messageCount: number;
}

export function parseOrigin(n: NodeRow): { messageId?: string; fragment?: string; summaryOf?: string } | null {
  if (!n.origin) return null;
  try {
    return JSON.parse(n.origin);
  } catch {
    return null;
  }
}

export function parseContextNodes(n: NodeRow): string[] {
  try {
    const v = JSON.parse(n.context_nodes || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const NODE_TYPE_META: Record<NodeType, { label: string; icon: string }> = {
  aiChat: { label: 'AI Chat', icon: '💬' },
  note: { label: 'Заметка', icon: '📝' },
  idea: { label: 'Идея', icon: '💡' },
  summary: { label: 'Сводка', icon: '🗂' },
  task: { label: 'Задача', icon: '✅' },
};

export const CONTEXT_MODE_LABEL: Record<ContextMode, string> = {
  current: 'Текущий узел',
  parent: 'Родительский контекст',
  selected: 'Выбранные узлы',
  workspace: 'Всё пространство',
};

export const EDGE_KIND_META: Record<EdgeKind, { label: string }> = {
  parent: { label: 'Родитель → потомок' },
  related: { label: 'Связаны' },
  derived: { label: 'Выведен из' },
};
