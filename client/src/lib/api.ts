import type {
  ContextSource,
  ContextMode,
  EdgeKind,
  HealthInfo,
  NodeRow,
  NodeType,
  WorkspaceFull,
} from './types';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'network', 'Сервер недоступен. Убедитесь, что backend запущен (npm run dev в server/).');
  }
  if (!res.ok) {
    let code = 'http_error';
    let message = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

const j = (v: unknown) => JSON.stringify(v);

export const api = {
  health: () => request<HealthInfo>('/health'),

  listWorkspaces: () => request<{ id: string; title: string; updated_at: string }[]>('/workspaces'),
  createWorkspace: (title: string) => request<WorkspaceFull>('/workspaces', { method: 'POST', body: j({ title }) }),
  getWorkspace: (id: string) => request<WorkspaceFull>(`/workspaces/${id}`),
  patchWorkspace: (id: string, patch: { title?: string; viewport?: unknown }) =>
    request<{ ok: boolean }>(`/workspaces/${id}`, { method: 'PATCH', body: j(patch) }),
  deleteWorkspace: (id: string) => request<{ ok: boolean }>(`/workspaces/${id}`, { method: 'DELETE' }),

  createNode(input: {
    workspaceId: string;
    type: NodeType;
    title?: string;
    x?: number;
    y?: number;
    content?: string;
    model?: string;
    temperature?: number;
    parentNodeId?: string | null;
    origin?: unknown;
    contextMode?: ContextMode;
    contextNodes?: string[];
  }) {
    return request<NodeRow>('/nodes', { method: 'POST', body: j(input) });
  },
  patchNode(id: string, patch: Record<string, unknown>) {
    return request<NodeRow>(`/nodes/${id}`, { method: 'PATCH', body: j(patch) });
  },
  deleteNode(id: string) {
    return request<{ ok: boolean }>(`/nodes/${id}`, { method: 'DELETE' });
  },

  createEdge(workspaceId: string, source: string, target: string, kind: EdgeKind) {
    return request<{ id: string }>('/edges', {
      method: 'POST',
      body: j({ workspaceId, source, target, kind }),
    });
  },
  patchEdge(id: string, kind: EdgeKind) {
    return request<{ ok: boolean }>(`/edges/${id}`, { method: 'PATCH', body: j({ kind }) });
  },
  deleteEdge(id: string) {
    return request<{ ok: boolean }>(`/edges/${id}`, { method: 'DELETE' });
  },

  deleteMessage(id: string) {
    return request<{ ok: boolean }>(`/messages/${id}`, { method: 'DELETE' });
  },

  contextPreview(nodeId: string, mode: ContextMode, selectedNodeIds: string[], userMessage: string) {
    return request<{ usedTokens: number; truncated: boolean; sources: ContextSource[] }>('/context/preview', {
      method: 'POST',
      body: j({ nodeId, mode, selectedNodeIds, userMessage }),
    });
  },

  synthesize(workspaceId: string, nodeIds: string[], instruction?: string) {
    return request<{ node: NodeRow; sourceIds: string[] }>('/synthesize', {
      method: 'POST',
      body: j({ workspaceId, nodeIds, ...(instruction ? { instruction } : {}) }),
    });
  },

  makeSummaryNode(nodeId: string) {
    return request<NodeRow>(`/nodes/${nodeId}/summary`, { method: 'POST' });
  },
};

// ---------- SSE streaming helpers (fetch + ReadableStream; POST + abortable) ----------

export interface StreamHandlers {
  onStart: (data: { userMessage?: { id: string; content: string }; assistantMessageId: string }) => void;
  onContext: (data: { usedTokens: number; truncated: boolean; sources: ContextSource[] }) => void;
  onDelta: (text: string) => void;
  onDone: (data: { messageId: string; tokens: number | null; promptTokens: number | null }) => void;
  onError: (data: { code: string; message: string; partialKept?: boolean }) => void;
  onNetworkFail: (message: string) => void;
}

async function streamPost(path: string, body: unknown, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    handlers.onNetworkFail('Сервер недоступен или соединение прервано.');
    return;
  }
  if (!res.ok || !res.body) {
    let message = `Ошибка сервера (${res.status})`;
    let code = 'http_error';
    try {
      const b = await res.json();
      if (b?.error) {
        message = b.error.message;
        code = b.error.code;
      }
    } catch {
      /* ignore */
    }
    handlers.onError({ code, message });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let data: any;
          try {
            data = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          switch (data.type) {
            case 'start':
              handlers.onStart(data);
              break;
            case 'context':
              handlers.onContext(data);
              break;
            case 'delta':
              handlers.onDelta(data.text);
              break;
            case 'done':
              handlers.onDone(data);
              break;
            case 'error':
              handlers.onError(data);
              break;
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') handlers.onNetworkFail('Поток оборвался: ' + (e as Error).message);
  }
}

export function streamGenerate(
  nodeId: string,
  payload: { content: string; contextMode?: ContextMode; selectedNodeIds?: string[]; systemOverride?: string },
  handlers: StreamHandlers,
  signal: AbortSignal,
) {
  return streamPost(`/nodes/${nodeId}/generate`, payload, handlers, signal);
}

export function streamRegenerate(nodeId: string, handlers: StreamHandlers, signal: AbortSignal) {
  return streamPost(`/nodes/${nodeId}/regenerate`, {}, handlers, signal);
}
