import { logger } from '../logger';
import { keepAliveAgent } from '../httpClient';
import { fetchWithTimeout, TIMEOUTS } from '../utils/fetchWithTimeout';

interface ChatMessage {
  role: string;
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: ChatMessage[];
  key: string;
}

interface OpenAIRealtimeRequest {
  model: string;
  key: string;
}

export async function openaiChat({ model, messages, key }: OpenAIChatRequest): Promise<any> {
  logger.debug(`OpenAI chat request with model: ${model}`);

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
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
    logger.error(`OpenAI chat API error: ${response.status} - ${errorText}`);
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  logger.debug(`OpenAI chat successful, usage: ${JSON.stringify(data.usage || {})}`);
  return data;
}

export async function openaiRealtimeSession({ model, key }: OpenAIRealtimeRequest): Promise<any> {
  logger.debug(`OpenAI realtime session with model: ${model}`);

  const response = await fetchWithTimeout('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      voice: 'alloy'
    }),
    agent: keepAliveAgent,
    timeout: TIMEOUTS.REALTIME
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`OpenAI realtime API error: ${response.status} - ${errorText}`);
    throw new Error(`OpenAI Realtime API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  logger.debug(`OpenAI realtime session created successfully`);
  return data;
}
