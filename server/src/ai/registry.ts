import { LlmProvider } from './types.js';
import { OpenAiProvider } from './openai.js';
import { DeepSeekProvider } from './deepseek.js';

// Provider registry — add new providers here (e.g. `providers.anthropic = new AnthropicProvider()`).
const providers: Record<string, LlmProvider> = {};

export function registerProvider(p: LlmProvider) { providers[p.id] = p; }
export function getProvider(id?: string): LlmProvider {
  const p = id ? providers[id] : defaultProvider();
  if (!p) throw new Error(`Provider "${id}" is not registered`);
  return p;
}

// Default provider: prefer a configured one among the registered ones.
let defaultId: string | undefined;
export function setDefaultProvider(id: string) { defaultId = id; }

function defaultProvider(): LlmProvider | undefined {
  if (defaultId && providers[defaultId]) return providers[defaultId];
  return Object.values(providers).find((p) => p.isConfigured()) ?? Object.values(providers)[0];
}

registerProvider(new DeepSeekProvider());
registerProvider(new OpenAiProvider());
setDefaultProvider('deepseek');
