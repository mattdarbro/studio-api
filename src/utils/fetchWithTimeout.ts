import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch';

/**
 * Fetch with automatic timeout handling
 * Throws an error if the request exceeds the specified timeout
 * Uses built-in AbortController (Node 15+)
 */
export async function fetchWithTimeout(
  url: RequestInfo,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 60000, ...fetchOptions } = options; // Default 60s

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal as any // Type assertion for node-fetch compatibility
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }

    throw error;
  }
}

/**
 * Recommended timeout values for different operations
 */
export const TIMEOUTS = {
  CHAT: 60000,        // 60s for chat completions
  IMAGE: 300000,      // 5min for image generation (can be slow)
  MUSIC: 300000,      // 5min for music generation
  VOICE: 30000,       // 30s for text-to-speech
  REALTIME: 30000,    // 30s for realtime session creation
  QUICK: 10000        // 10s for quick API calls (model lookup, etc.)
} as const;
