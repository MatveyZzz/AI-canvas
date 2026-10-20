import { describe, it, expect } from 'vitest';
import { getProvider } from './registry.js';
import { DeepSeekProvider } from './deepseek.js';
import { normalizeHttpError } from './openai.js';

describe('DeepSeek provider', () => {
  it('is the default provider with deepseek models', () => {
    const p = getProvider();
    expect(p.id).toBe('deepseek');
    expect(p.listModels()).toContain('deepseek-chat');
    expect(p.listModels()).toContain('deepseek-reasoner');
    expect(p.contextWindow('deepseek-chat')).toBe(128000);
  });

  it('hint mentions DEEPSEEK_API_KEY when key missing', () => {
    delete process.env.DEEPSEEK_API_KEY;
    const p = new DeepSeekProvider();
    expect(p.isConfigured()).toBe(false);
    expect(p.missingKeyHint()).toContain('DEEPSEEK_API_KEY');
  });

  it('picks up DEEPSEEK_API_KEY from env (key stays server-side)', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const p = new DeepSeekProvider();
    expect(p.isConfigured()).toBe(true);
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('normalizes auth errors', () => {
    const e = normalizeHttpError(401, '{"error":{"message":"Invalid API key"}}');
    expect(e.code).toBe('auth');
  });

  it('OpenAI remains available as fallback provider', () => {
    expect(getProvider('openai').id).toBe('openai');
  });
});
