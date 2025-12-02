/**
 * Provider API Pricing Configuration
 *
 * All prices are in USD.
 * Token prices are per 1,000 tokens.
 * Update these periodically as provider pricing changes.
 *
 * Last updated: 2025-11-26
 */

import { get_encoding } from 'tiktoken';

export interface TokenPricing {
  input: number;   // Cost per 1K input tokens (USD)
  output: number;  // Cost per 1K output tokens (USD)
}

export interface ImagePricing {
  perImage: number; // Cost per image generated (USD)
}

export interface MusicPricing {
  perSecond: number; // Cost per second of audio (USD)
}

export const PRICING = {
  openai: {
    // GPT-5.1 pricing (as of Nov 2025)
    'gpt-5.1': { input: 0.003, output: 0.012 } as TokenPricing,

    // GPT-5 pricing
    'gpt-5': { input: 0.0025, output: 0.010 } as TokenPricing,

    // GPT-4o pricing
    'gpt-4o': { input: 0.0025, output: 0.010 } as TokenPricing,
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 } as TokenPricing,

    // o4-mini reasoning model
    'o4-mini': { input: 0.0011, output: 0.0044 } as TokenPricing,

    // Realtime API
    'gpt-4o-realtime-preview': { input: 0.005, output: 0.020 } as TokenPricing,

    // TTS models (per 1M characters)
    'tts-1': { input: 0.015, output: 0.0 } as TokenPricing,        // $15 per 1M chars
    'tts-1-hd': { input: 0.030, output: 0.0 } as TokenPricing,     // $30 per 1M chars
  },

  anthropic: {
    // Claude Opus 4.5 (Nov 2025)
    'claude-opus-4-5-20251101': { input: 0.005, output: 0.025 } as TokenPricing,

    // Claude Sonnet 4.5
    'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 } as TokenPricing,

    // Claude Haiku 4.5
    'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.004 } as TokenPricing,
  },

  grok: {
    // Grok 4.1 pricing (xAI - Nov 2025)
    'grok-4-1-fast-reasoning': { input: 0.0002, output: 0.0005 } as TokenPricing,
    'grok-4-1-fast-non-reasoning': { input: 0.0002, output: 0.0005 } as TokenPricing,

    // Legacy Grok models
    'grok-4-fast-reasoning': { input: 0.002, output: 0.010 } as TokenPricing,
    'grok-4-fast-nonreasoning': { input: 0.002, output: 0.010 } as TokenPricing,
  },

  replicate: {
    // Flux models (Replicate)
    'black-forest-labs/flux-schnell': { perImage: 0.003 } as ImagePricing,
    'black-forest-labs/flux-dev': { perImage: 0.055 } as ImagePricing,
    'black-forest-labs/flux-pro': { perImage: 0.055 } as ImagePricing,
  },

  elevenlabs: {
    // Music generation - approximate pricing per second
    'eleven_music': { perSecond: 0.0012 } as MusicPricing,

    // Voice/TTS models
    'eleven_turbo_v2_5': { input: 0.0002, output: 0.0 } as TokenPricing, // Approx per character
    'eleven_flash_v2_5': { input: 0.0001, output: 0.0 } as TokenPricing,
    'eleven_multilingual_v2': { input: 0.00024, output: 0.0 } as TokenPricing,
  },
};

/**
 * Calculate cost for token-based models (chat, voice)
 */
export function calculateTokenCost(
  provider: keyof typeof PRICING,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return 0;

  const modelPricing = providerPricing[model as keyof typeof providerPricing] as any;
  if (!modelPricing) return 0;

  // Check if it's token-based pricing
  if ('input' in modelPricing && 'output' in modelPricing) {
    const inputCost = (inputTokens / 1000) * (modelPricing.input as number);
    const outputCost = (outputTokens / 1000) * (modelPricing.output as number);
    return inputCost + outputCost;
  }

  return 0;
}

/**
 * Calculate cost for image generation
 */
export function calculateImageCost(
  provider: keyof typeof PRICING,
  model: string,
  numImages: number = 1
): number {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return 0;

  const modelPricing = providerPricing[model as keyof typeof providerPricing] as any;
  if (!modelPricing) return 0;

  // Check if it's image pricing
  if ('perImage' in modelPricing) {
    return (modelPricing.perImage as number) * numImages;
  }

  return 0;
}

/**
 * Calculate cost for music/audio generation
 */
export function calculateMusicCost(
  provider: keyof typeof PRICING,
  model: string,
  durationSeconds: number
): number {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return 0;

  const modelPricing = providerPricing[model as keyof typeof providerPricing] as any;
  if (!modelPricing) return 0;

  // Check if it's music pricing
  if ('perSecond' in modelPricing) {
    return (modelPricing.perSecond as number) * durationSeconds;
  }

  return 0;
}

// Cache the encoding to avoid repeated initialization
let cachedEncoding: ReturnType<typeof get_encoding> | null = null;

/**
 * Get token count using tiktoken (accurate tokenization)
 * Uses cl100k_base encoding (GPT-4, GPT-3.5-turbo, text-embedding-ada-002)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  try {
    // Initialize encoding once and cache it
    if (!cachedEncoding) {
      cachedEncoding = get_encoding('cl100k_base');
    }

    const tokens = cachedEncoding.encode(text);
    return tokens.length;
  } catch (error) {
    // Fallback to rough estimate if tiktoken fails
    console.error('Tiktoken encoding failed, using fallback estimation:', error);
    return Math.ceil(text.length / 4);
  }
}

/**
 * Free the tiktoken encoding resources (call on shutdown)
 */
export function freeTokenEncoding(): void {
  if (cachedEncoding) {
    cachedEncoding.free();
    cachedEncoding = null;
  }
}
