import { logger } from '../logger';
import { keepAliveAgent } from '../httpClient';
import { fetchWithTimeout, TIMEOUTS } from '../utils/fetchWithTimeout';

interface ChatMessage {
  role: string;
  content: string | any[];  // Support both string and array content for vision
}

interface GrokChatRequest {
  model: string;
  messages: ChatMessage[];
  key: string;
}

export async function grokChat({ model, messages, key }: GrokChatRequest): Promise<any> {
  logger.debug(`Grok chat request with model: ${model}`);

  // Grok (xAI) uses OpenAI-compatible API
  const response = await fetchWithTimeout('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages
    }),
    agent: keepAliveAgent,
    timeout: TIMEOUTS.CHAT
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Grok API error: ${response.status} - ${errorText}`);
    throw new Error(`Grok API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  logger.debug(`Grok chat successful, usage: ${JSON.stringify(data.usage || {})}`);
  return data;
}
