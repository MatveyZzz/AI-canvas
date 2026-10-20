import { LlmProvider } from './types.js';
import { OpenAiProvider } from './openai.js';

// Provider registry — add new providers here (e.g. `providers.anthropic = new AnthropicProvider()`).
const providers: Record<string, LlmProvider> = {};

export function registerProvider(p: LlmProvider) { providers[p.id] = p; }
export function getProvider(id?: string): LlmProvider {
  const p = id ? providers[id] : Object.values(providers)[0];
  if (!p) throw new Error(`Provider "${id}" is not registered`);
  return p;
}

registerProvider(new OpenAiProvider());
