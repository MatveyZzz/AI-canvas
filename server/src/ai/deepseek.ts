// DeepSeek provider. DeepSeek exposes an OpenAI-compatible API, so the transport
// (SSE streaming, error normalization) is reused from openai.ts; only the
// defaults differ: base URL https://api.deepseek.com, DEEPSEEK_API_KEY, model list.
//
// Env vars:
//   DEEPSEEK_API_KEY   — required (never sent to the browser)
//   DEEPSEEK_BASE_URL  — optional override (default https://api.deepseek.com)
//   DEEPSEEK_MODELS    — optional "id:Label:contextWindow,..." list

import { ChatMessage, GenerateOptions, LlmProvider, StreamChunk } from './types.js';
import { OpenAiProvider, type ModelDef } from './openai.js';

const DEFAULT_MODELS: ModelDef[] = [
  // Official DeepSeek context window is 128K tokens for both chat models.
  { id: 'deepseek-chat', label: 'DeepSeek Chat (V3)', contextWindow: 128000 },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)', contextWindow: 128000 },
];

export class DeepSeekProvider extends OpenAiProvider implements LlmProvider {
  readonly id: string = 'deepseek';

  constructor() {
    super();
    // Re-point everything at DeepSeek. The key lives ONLY on the server.
    this.setTransport({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      models: loadModels(),
      keyName: 'DEEPSEEK_API_KEY',
    });
  }

  override missingKeyHint() {
    return (
      'DEEPSEEK_API_KEY не задан. Скопируйте server/.env.example в server/.env, ' +
      'укажите ключ из platform.deepseek.com (DEEPSEEK_API_KEY=sk-...) и перезапустите сервер.'
    );
  }
}

function loadModels(): ModelDef[] {
  const raw = process.env.DEEPSEEK_MODELS;
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
