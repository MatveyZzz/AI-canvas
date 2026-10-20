// Unified LLM provider interface. Adding Anthropic/Google/etc. means implementing
// this interface and registering it in registry.ts — nothing else changes.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
}

export type StreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'done' };

export interface LlmProvider {
  readonly id: string;
  /** Human-readable availability status for the UI / health endpoint. */
  isConfigured(): boolean;
  missingKeyHint(): string;
  listModels(): string[];
  contextWindow(model: string): number;
  /** Stream a chat completion. Must throw ProviderError on failure. */
  streamChat(messages: ChatMessage[], opts: GenerateOptions): AsyncIterable<StreamChunk>;
}

export class ProviderError extends Error {
  code: 'no_api_key' | 'auth' | 'rate_limit' | 'context_length' | 'timeout' | 'network' | 'provider' | 'unknown';
  status?: number;
  constructor(code: ProviderError['code'], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Rough token estimate (~4 chars/token for Latin text). Used when the API doesn't report usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((s, m) => s + estimateTokens(m.content) + 4, 0);
}
