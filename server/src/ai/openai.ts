import {
  ChatMessage, GenerateOptions, LlmProvider, ProviderError, StreamChunk,
} from './types.js';

// OpenAI-compatible provider (OpenAI by default; any compatible base URL via env).
// Model list and context windows are configuration-driven so new models can be
// added without code changes.

export interface ModelDef { id: string; label: string; contextWindow: number }

const DEFAULT_MODELS: ModelDef[] = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextWindow: 128000 },
  { id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128000 },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', contextWindow: 128000 },
];

function loadModels(): ModelDef[] {
  const raw = process.env.OPENAI_MODELS; // e.g. "my-model:My Model:32768,other-model:Other:8192"
  if (!raw) return DEFAULT_MODELS;
  try {
    return raw.split(',').map((part) => {
      const [id, label, ctx] = part.split(':');
      return { id: id.trim(), label: (label || id).trim(), contextWindow: Number(ctx) || 128000 };
    });
  } catch {
    return DEFAULT_MODELS;
  }
}

export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai';
  private apiKey: string | undefined;
  private baseUrl: string;
  private models: ModelDef[];

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.models = loadModels();
  }

  isConfigured() { return Boolean(this.apiKey); }

  missingKeyHint() {
    return 'OPENAI_API_KEY не задан. Скопируйте .env.example в server/.env и укажите ключ: OPENAI_API_KEY=sk-... , затем перезапустите сервер.';
  }

  listModels() { return this.models.map((m) => m.id); }

  contextWindow(model: string) {
    return this.models.find((m) => m.id === model)?.contextWindow ?? 128000;
  }

  async *streamChat(messages: ChatMessage[], opts: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.apiKey) throw new ProviderError('no_api_key', this.missingKeyHint());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), 120_000);
    const onAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 2048,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (opts.signal?.aborted) { controller.abort(); throw toAbortError(err); }
      if ((err as Error).name === 'AbortError') throw new ProviderError('timeout', 'Превышен тайм-аут запроса к провайдеру.');
      throw new ProviderError('network', `Сетевая ошибка при обращении к провайдеру: ${(err as Error).message}`);
    }

    if (!res.ok || !res.body) {
      clearTimeout(timeout);
      const body = await res.text().catch(() => '');
      throw normalizeHttpError(res.status, body);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { yield { type: 'done' }; continue; }
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) yield { type: 'delta', text: delta };
            if (json.usage) {
              yield {
                type: 'usage',
                usage: {
                  promptTokens: json.usage.prompt_tokens,
                  completionTokens: json.usage.completion_tokens,
                },
              };
            }
          } catch { /* ignore keep-alive / malformed frames */ }
        }
      }
      yield { type: 'done' };
    } catch (err) {
      if (opts.signal?.aborted) throw err; // user abort — propagate as-is
      if ((err as Error).name === 'AbortError') throw new ProviderError('timeout', 'Превышен тайм-аут стрима.');
      throw new ProviderError('provider', `Ошибка чтения потока: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onAbort);
      reader.cancel().catch(() => {});
    }
  }
}

function toAbortError(err: unknown) {
  return (err as Error)?.name === 'AbortError' ? err : new ProviderError('network', String(err));
}

/** Normalize provider HTTP errors into a stable shape the client can render. */
export function normalizeHttpError(status: number, body: string): ProviderError {
  let msg = body.slice(0, 500);
  try { msg = JSON.parse(body)?.error?.message ?? msg; } catch { /* raw */ }
  switch (status) {
    case 401: case 403:
      return new ProviderError('auth', `API-ключ отклонён провайдером (${status}). Проверьте OPENAI_API_KEY.`, status);
    case 429:
      return new ProviderError('rate_limit', 'Превышен лимит запросов или квоты провайдера (429). Попробуйте позже.', status);
    default:
      if (/context length|maximum context|too many tokens/i.test(msg)) {
        return new ProviderError('context_length', 'Контекст превышает лимит модели. Сократите историю или используйте сводку.', status);
      }
      return new ProviderError('provider', `Ошибка провайдера (${status}): ${msg}`, status);
  }
}

export function errorToPublic(err: unknown): { code: string; message: string } {
  if (err instanceof ProviderError) return { code: err.code, message: err.message };
  if ((err as Error)?.name === 'AbortError') return { code: 'aborted', message: 'Генерация остановлена.' };
  return { code: 'unknown', message: 'Внутренняя ошибка сервера.' };
}
