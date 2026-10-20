import { Router } from 'express';
import { z } from 'zod';
import * as store from '../db/store.js';
import { summarizeNode } from '../ai/context.js';
import { getProvider } from '../ai/registry.js';
import { buildContext } from '../ai/context.js';
import { errorToPublic } from '../ai/openai.js';
import { estimateMessagesTokens } from '../ai/types.js';

const MAX_MESSAGE_CHARS = 32_000;

export const api = Router();

// ---------- Validation schemas ----------
const nodeType = z.enum(['aiChat', 'note', 'idea', 'summary', 'task']);
const edgeKind = z.enum(['parent', 'related', 'derived']);
const contextMode = z.enum(['current', 'parent', 'selected', 'workspace']);

const workspaceCreate = z.object({ title: z.string().min(1).max(200) });
const workspacePatch = z.object({ title: z.string().min(1).max(200).optional(), viewport: z.record(z.number()).optional() });

const nodeCreate = z.object({
  workspaceId: z.string().min(1),
  type: nodeType,
  title: z.string().max(200).default(''),
  x: z.number().default(0), y: z.number().default(0),
  width: z.number().positive().max(2000).default(360),
  height: z.number().positive().max(4000).default(260),
  content: z.string().max(MAX_MESSAGE_CHARS).default(''),
  model: z.string().max(100).default('gpt-4o-mini'),
  temperature: z.number().min(0).max(2).default(0.7),
  parentNodeId: z.string().nullable().default(null),
  origin: z.unknown().nullish(),
  contextMode: contextMode.default('current'),
  contextNodes: z.array(z.string()).default([]),
});

const nodePatch = z.object({
  title: z.string().max(200).optional(),
  x: z.number().optional(), y: z.number().optional(),
  width: z.number().positive().max(2000).optional(),
  height: z.number().positive().max(4000).optional(),
  content: z.string().max(MAX_MESSAGE_CHARS).optional(),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  contextMode: contextMode.optional(),
  contextNodes: z.array(z.string()).optional(),
  collapsed: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

const messageSend = z.object({
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
  contextMode: contextMode.optional(),
  selectedNodeIds: z.array(z.string()).max(50).optional(),
  systemOverride: z.string().max(8000).optional(),
  regenerateFromUserMessageId: z.string().optional(),
});

const synthesis = z.object({
  workspaceId: z.string().min(1),
  nodeIds: z.array(z.string()).min(2).max(30),
  instruction: z.string().max(4000).default('Синтезируй выводы из этих узлов: сравни позиции, найди противоречия, сформулируй общий итог и предложи следующие вопросы.'),
});

const edgeCreate = z.object({
  workspaceId: z.string().min(1),
  source: z.string().min(1), target: z.string().min(1),
  kind: edgeKind.default('related'),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw httpError(400, 'validation_error', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

function httpError(status: number, code: string, message: string) {
  const e = new Error(message) as Error & { status?: number; code?: string };
  e.status = status; e.code = code;
  return e;
}

function snapshotOf(workspaceId: string) {
  const nodes = store.listNodes(workspaceId);
  const messagesByNode: Record<string, store.MessageRow[]> = {};
  for (const n of nodes) messagesByNode[n.id] = store.listMessages(n.id);
  return { nodes, messagesByNode };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ---------- Health / provider info ----------
api.get('/health', (_req, res) => {
  const p = getProvider();
  res.json({
    ok: true,
    provider: p.id,
    configured: p.isConfigured(),
    hint: p.isConfigured() ? null : p.missingKeyHint(),
    models: p.listModels(),
  });
});

// ---------- Workspaces ----------
api.post('/workspaces', (req, res) => {
  const { title } = parse(workspaceCreate, req.body);
  res.status(201).json(store.createWorkspace(title));
});

api.get('/workspaces', (_req, res) => res.json(store.listWorkspaces()));

api.get('/workspaces/:id', (req, res) => {
  const ws = store.getWorkspace(req.params.id);
  if (!ws) throw httpError(404, 'not_found', 'Рабочее пространство не найдено');
  res.json(ws);
});

api.patch('/workspaces/:id', (req, res) => {
  const patch = parse(workspacePatch, req.body);
  store.updateWorkspace(req.params.id, patch);
  res.json({ ok: true });
});

api.delete('/workspaces/:id', (req, res) => {
  store.deleteWorkspace(req.params.id);
  res.json({ ok: true });
});

// ---------- Nodes ----------
api.post('/nodes', (req, res) => {
  const input = parse(nodeCreate, req.body);
  const node = store.createNode({
    workspace_id: input.workspaceId, type: input.type, title: input.title,
    x: input.x, y: input.y, width: input.width, height: input.height,
    content: input.content, model: input.model, temperature: input.temperature,
    parent_node_id: input.parentNodeId, origin: input.origin ?? undefined,
    context_mode: input.contextMode, context_nodes: input.contextNodes,
  });
  res.status(201).json(node);
});

api.patch('/nodes/:id', (req, res) => {
  const patch = parse(nodePatch, req.body);
  const node = store.updateNode(req.params.id, patch as never);
  if (!node) throw httpError(404, 'not_found', 'Узел не найден');
  res.json(node);
});

api.delete('/nodes/:id', (req, res) => {
  store.deleteNode(req.params.id);
  res.json({ ok: true });
});

// ---------- Messages ----------
api.get('/nodes/:id/messages', (req, res) => res.json(store.listMessages(req.params.id)));

api.delete('/messages/:id', (req, res) => {
  store.deleteMessage(req.params.id);
  res.json({ ok: true });
});

// Context preview — the UI shows exactly what will be sent before generation.
api.post('/context/preview', (req, res) => {
  const body = parse(
    z.object({ nodeId: z.string(), mode: contextMode, selectedNodeIds: z.array(z.string()).optional(), userMessage: z.string().max(MAX_MESSAGE_CHARS) }),
    req.body,
  );
  const node = store.getNode(body.nodeId);
  if (!node) throw httpError(404, 'not_found', 'Узел не найден');
  const snapshot = snapshotOf(node.workspace_id);
  const provider = getProvider();
  const built = buildContext({
    nodeId: node.id, mode: body.mode, selectedNodeIds: body.selectedNodeIds,
    userMessage: body.userMessage || '(черновик сообщения)',
    maxTokens: provider.contextWindow(node.model),
  }, snapshot);
  res.json(built);
});

// Core streaming routine shared by generate and regenerate.
async function runGeneration(node: store.NodeRow, userContent: string, input: z.infer<typeof messageSend>, res: import('express').Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  // Persist user message FIRST — history is never lost on generation failure.
  let userMsg: store.MessageRow;
  let assistantMsg: store.MessageRow;
  if (input.regenerateFromUserMessageId) {
    // Regenerate: reuse existing user message, drop previous assistant tail.
    userMsg = store.listMessages(node.id).find((m) => m.id === input.regenerateFromUserMessageId)!;
    assistantMsg = store.addMessage(node.id, 'assistant', '', { pending: true });
  } else {
    userMsg = store.addMessage(node.id, 'user', userContent);
    assistantMsg = store.addMessage(node.id, 'assistant', '', { pending: true });
  }
  store.updateNode(node.id, { status: 'generating' });
  send({ type: 'start', userMessage: userMsg, assistantMessageId: assistantMsg.id });

  const ac = new AbortController();
  res.on('close', () => ac.abort());

  let acc = '';
  try {
    const provider = getProvider();
    const snapshot = snapshotOf(node.workspace_id);
    const built = buildContext({
      nodeId: node.id,
      mode: input.contextMode ?? node.context_mode,
      selectedNodeIds: input.selectedNodeIds ?? JSON.parse(node.context_nodes || '[]'),
      userMessage: userContent,
      maxTokens: provider.contextWindow(node.model),
    }, snapshot);

    let messages = built.messages;
    if (input.systemOverride) {
      messages = [
        { role: 'system' as const, content: input.systemOverride },
        ...messages.filter((m) => m.role !== 'system'),
      ];
    }
    send({ type: 'context', usedTokens: built.usedTokens, truncated: built.truncated, sources: built.sources });

    let usage: { promptTokens?: number; completionTokens?: number } | null = null;
    for await (const chunk of provider.streamChat(messages, {
      model: node.model, temperature: node.temperature, signal: ac.signal,
    })) {
      if (chunk.type === 'delta') { acc += chunk.text; send({ type: 'delta', text: chunk.text }); }
      else if (chunk.type === 'usage') usage = chunk.usage;
    }
    store.updateMessage(assistantMsg.id, {
      content: acc, pending: false,
      tokens: usage?.completionTokens ?? Math.ceil(acc.length / 4),
    });
    store.updateNode(node.id, { status: 'idle' });
    send({ type: 'done', messageId: assistantMsg.id, tokens: usage?.completionTokens ?? null, promptTokens: usage?.promptTokens ?? null });
  } catch (err) {
    const aborted = ac.signal.aborted || (err as Error)?.name === 'AbortError';
    const pub = aborted ? { code: 'aborted', message: 'Генерация остановлена пользователем.' } : errorToPublic(err);
    // Keep whatever partial text arrived — do not lose history.
    store.updateMessage(assistantMsg.id, { content: acc, pending: !aborted && acc.length > 0 });
    store.updateNode(node.id, { status: aborted ? 'idle' : 'error' });
    send({ type: 'error', code: pub.code, message: pub.message, partialKept: acc.length > 0 });
  } finally {
    res.end();
  }
}

api.post('/nodes/:id/generate', async (req, res) => {
  const node = store.getNode(req.params.id);
  if (!node) throw httpError(404, 'not_found', 'Узел не найден');
  const input = parse(messageSend, req.body);
  await runGeneration(node, input.content, input, res);
});

// Regenerate the last assistant answer with the same user message.
api.post('/nodes/:id/regenerate', async (req, res) => {
  const node = store.getNode(req.params.id);
  if (!node) throw httpError(404, 'not_found', 'Узел не найден');
  const msgs = store.listMessages(node.id);
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw httpError(400, 'no_user_message', 'Нет сообщения пользователя для повторной генерации');
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant) store.deleteMessage(lastAssistant.id);
  const input = parse(messageSend, {
    content: lastUser.content,
    regenerateFromUserMessageId: lastUser.id,
    ...(req.body ?? {}),
  });
  await runGeneration(node, lastUser.content, input, res);
});

// ---------- Synthesis (multiple nodes -> new AI Chat with combined context) ----------
api.post('/synthesize', (req, res) => {
  const input = parse(synthesis, req.body);
  const provider = getProvider();
  const snapshot = snapshotOf(input.workspaceId);
  const nodes = input.nodeIds.map((id) => snapshot.nodes.find((n) => n.id === id)).filter(Boolean) as store.NodeRow[];
  if (nodes.length < 2) throw httpError(400, 'not_enough_nodes', 'Нужно минимум два существующих узла');

  const blocks = nodes.map((n) => {
    const label = n.title || `${n.type} ${n.id.slice(0, 4)}`;
    const digest = summarizeNode(n, snapshot.messagesByNode[n.id] ?? [], 1500);
    return `### Узел «${label}» (${n.type})\n${digest}`;
  });
  const prompt = `${input.instruction}\n\nМатериалы:\n\n${blocks.join('\n\n')}`;
  if (estimateMessagesTokens([{ role: 'user', content: prompt }]) > provider.contextWindow('gpt-4o-mini') - 3000) {
    throw httpError(400, 'context_length', 'Выбранные узлы слишком велики для синтеза. Создайте сначала сводки по отдельным веткам.');
  }

  const newNode = store.createNode({
    workspace_id: input.workspaceId, type: 'aiChat',
    title: `Синтез: ${nodes.map((n) => n.title || n.type).slice(0, 3).join(', ')}`,
    x: avg(nodes.map((n) => n.x)) + 460, y: avg(nodes.map((n) => n.y)),
    context_mode: 'selected', context_nodes: input.nodeIds,
  });
  for (const n of nodes) store.createEdge(input.workspaceId, n.id, newNode.id, 'derived');
  store.addMessage(newNode.id, 'user', prompt);
  store.addMessage(newNode.id, 'assistant', '', { pending: true });
  res.status(201).json({ node: newNode, sourceIds: input.nodeIds });
});

// Deterministic summary node (no API call required).
api.post('/nodes/:id/summary', (req, res) => {
  const src = store.getNode(req.params.id);
  if (!src) throw httpError(404, 'not_found', 'Узел не найден');
  const snapshot = snapshotOf(src.workspace_id);
  const digest = summarizeNode(src, snapshot.messagesByNode[src.id] ?? [], 2000);
  const node = store.createNode({
    workspace_id: src.workspace_id, type: 'summary',
    title: `Сводка: ${src.title || src.type}`,
    x: src.x + 420, y: src.y - 40, content: digest,
    parent_node_id: src.id, origin: { summaryOf: src.id },
  });
  store.createEdge(src.workspace_id, src.id, node.id, 'derived');
  res.status(201).json(node);
});

// ---------- Edges ----------
api.post('/edges', (req, res) => {
  const input = parse(edgeCreate, req.body);
  const s = store.getNode(input.source), t = store.getNode(input.target);
  if (!s || !t) throw httpError(400, 'bad_edge', 'Оба конца связи должны существовать');
  res.status(201).json(store.createEdge(input.workspaceId, input.source, input.target, input.kind));
});

api.patch('/edges/:id', (req, res) => {
  const { kind } = parse(z.object({ kind: edgeKind }), req.body);
  store.updateEdge(req.params.id, kind);
  res.json({ ok: true });
});

api.delete('/edges/:id', (req, res) => {
  store.deleteEdge(req.params.id);
  res.json({ ok: true });
});
