// Context Engine: selects and bounds the context sent to the model.
// Modes: current | parent | selected | workspace.
// Oversized context is compacted with deterministic summarization of older items
// (never silently dropping random messages).

import { ChatMessage, estimateMessagesTokens, estimateTokens } from './types.js';
import type { NodeRow, MessageRow } from '../db/store.js';

export type ContextMode = 'current' | 'parent' | 'selected' | 'workspace';

export interface WorkspaceSnapshot {
  nodes: NodeRow[];
  messagesByNode: Record<string, MessageRow[]>;
}

export interface BuildContextInput {
  nodeId: string;
  mode: ContextMode;
  /** Explicit node ids for 'selected' mode. */
  selectedNodeIds?: string[];
  /** New user message appended last. */
  userMessage: string;
  /** Token budget for the whole context (defaults to provider window minus reserve). */
  maxTokens: number;
}

export interface BuiltContext {
  messages: ChatMessage[];
  usedTokens: number;
  truncated: boolean;
  sources: { nodeId: string; title: string; kind: string; messageCount: number }[];
}

const RESERVED_OUTPUT_TOKENS = 2048;

function nodeLabel(n: NodeRow): string {
  return n.title || `${n.type} ${n.id.slice(0, 4)}`;
}

function chatFromMessages(msgs: MessageRow[]): ChatMessage[] {
  return msgs
    .filter((m) => m.content.trim().length > 0 && !m.pending)
    .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content }));
}

/** Compact digest of a node for cross-node context. */
export function summarizeNode(node: NodeRow, msgs: MessageRow[], maxChars = 700): string {
  if (node.type !== 'aiChat') {
    const body = node.content.trim();
    return body.length > maxChars ? body.slice(0, maxChars) + '…' : body;
  }
  const lines: string[] = [];
  const firstUser = msgs.find((m) => m.role === 'user');
  if (firstUser) lines.push(`Вопрос: ${clip(firstUser.content, 160)}`);
  // Take up to 3 most recent substantive exchanges, clipped.
  const recent = msgs.filter((m) => !m.pending).slice(-4);
  for (const m of recent) {
    lines.push(`${m.role === 'user' ? 'Пользователь' : 'Модель'}: ${clip(m.content, 180)}`);
  }
  return clip(lines.join('\n'), maxChars);
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** Deterministic compaction: keep newest turns verbatim, replace older ones with digest. */
function fitHistory(history: ChatMessage[], budgetTokens: number): { messages: ChatMessage[]; truncated: boolean } {
  let total = estimateMessagesTokens(history);
  if (total <= budgetTokens) return { messages: history, truncated: false };

  // Keep the tail that fits, then prepend a digest of what was dropped.
  const kept: ChatMessage[] = [];
  let acc = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content) + 4;
    if (acc + cost > budgetTokens * 0.8) break; // leave room for the digest
    kept.unshift(history[i]);
    acc += cost;
  }
  const dropped = history.slice(0, history.length - kept.length);
  if (!dropped.length) return { messages: kept, truncated: false };
  const digestLines = dropped.map((m) => `${m.role}: ${clip(m.content, 120)}`);
  // Compress digest itself if needed.
  const digest = clip(digestLines.join(' | '), Math.min(budgetTokens * 4, 4000));
  return {
    messages: [
      { role: 'system', content: `[Сводка более ранних сообщений этой ветки — оригиналы сокращены системой контекста]\n${digest}` },
      ...kept,
    ],
    truncated: true,
  };
}

export function buildContext(input: BuildContextInput, snapshot: WorkspaceSnapshot): BuiltContext {
  const node = snapshot.nodes.find((n) => n.id === input.nodeId);
  if (!node) throw new Error('node not found');

  const budget = input.maxTokens - RESERVED_OUTPUT_TOKENS;
  const sources: BuiltContext['sources'] = [];
  const blocks: string[] = [];
  const ownHistory = chatFromMessages(snapshot.messagesByNode[node.id] ?? []);

  const addNodeBlock = (n: NodeRow, headerKind: string) => {
    const msgs = snapshot.messagesByNode[n.id] ?? [];
    const text = summarizeNode(n, msgs);
    if (!text) return;
    blocks.push(`### ${headerKind}: «${nodeLabel(n)}»\n${text}`);
    sources.push({ nodeId: n.id, title: nodeLabel(n), kind: headerKind, messageCount: msgs.length });
  };

  let contextNote = '';
  switch (input.mode) {
    case 'current':
      contextNote = 'Контекст: только текущий узел.';
      break;
    case 'parent': {
      const parentId = node.parent_node_id;
      const parent = parentId ? snapshot.nodes.find((n) => n.id === parentId) : null;
      if (parent) addNodeBlock(parent, 'Родительская ветка');
      contextNote = parent
        ? `Контекст: текущий узел + сводка родительского узла «${nodeLabel(parent)}».`
        : 'Контекст: текущий узел (родительский узел отсутствует).';
      break;
    }
    case 'selected': {
      const ids = (input.selectedNodeIds ?? []).filter((id) => id !== node.id);
      for (const id of ids) {
        const n = snapshot.nodes.find((x) => x.id === id);
        if (n) addNodeBlock(n, 'Выбранный узел');
      }
      contextNote = ids.length ? `Контекст: выбранные узлы (${ids.length}) + текущий диалог.` : 'Контекст: выбранных узлов нет, используется только текущий диалог.';
      break;
    }
    case 'workspace': {
      const others = snapshot.nodes.filter((n) => n.id !== node.id && !n.hidden);
      for (const n of others.slice(0, 20)) addNodeBlock(n, 'Узел пространства');
      contextNote = `Контекст: сводка по рабочему пространству (${Math.min(others.length, 20)} узлов).`;
      break;
    }
  }

  // Assemble: system note + external blocks (budget headroom) + own history + new user msg.
  const userCost = estimateTokens(input.userMessage) + 8;
  let external = blocks.length
    ? { role: 'system' as const, content: `[Информация из других узлов — режим "${input.mode}"]\n\n${blocks.join('\n\n')}` }
    : null;

  let externalCost = external ? estimateTokens(external.content) : 0;
  const historyBudget = budget - userCost - externalCost - 50;
  let fitted = fitHistory(ownHistory, Math.max(200, historyBudget));

  // If external blocks still push us over, shrink them by clipping.
  let truncated = fitted.truncated;
  if (external) {
    const totalNow = estimateMessagesTokens([external, ...fitted.messages]) + userCost;
    if (totalNow > budget) {
      const allowed = Math.max(200, budget - estimateMessagesTokens(fitted.messages) - userCost - 50);
      external = { role: 'system', content: clip(external.content, allowed * 4) };
      truncated = true;
    }
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Ты — исследовательский ассистент в визуальном инструменте AI Canvas. Отвечай на языке пользователя, используй Markdown. ' +
        contextNote +
        ' Если передан контекст из других узлов, считай его справочным материалом.',
    },
    ...(external ? [external] : []),
    ...fitted.messages,
    { role: 'user', content: input.userMessage },
  ];

  return {
    messages,
    usedTokens: estimateMessagesTokens(messages),
    truncated,
    sources,
  };
}

export { RESERVED_OUTPUT_TOKENS };
