import fetch from 'node-fetch';
import { logger } from '../logger';
import { keepAliveAgent } from '../httpClient';

interface ChatMessage {
  role: string;
  content: string;
}

interface AnthropicChatRequest {
  model: string;
  messages: ChatMessage[];
  key: string;
  max_tokens?: number;
}

export async function anthropicChat({ model, messages, key, max_tokens = 4096 }: AnthropicChatRequest): Promise<any> {
  logger.debug(`Anthropic chat request with model: ${model}`);

  // Convert OpenAI-style messages to Anthropic format
  // Anthropic doesn't use "system" role in messages array
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const systemPrompt = systemMessages.map(m => m.content).join('\n');

  const anthropicMessages = nonSystemMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: [
      {
        type: 'text',
        text: msg.content
      }
    ]
  }));

  const requestBody: any = {
    model,
    messages: anthropicMessages,
    max_tokens
  };

  if (systemPrompt) {
    requestBody.system = systemPrompt;
  }

  logger.debug(`Anthropic request: ${anthropicMessages.length} messages`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody),
    agent: keepAliveAgent
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Anthropic API error: ${response.status} - ${errorText}`);
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as any;
  logger.debug(`Anthropic chat successful, usage: ${JSON.stringify(data.usage || {})}`);

  const contentBlocks = Array.isArray(data.content) ? data.content : [];

  const extractText = (segment: any): string => {
    if (!segment) {
      return '';
    }

    if (typeof segment === 'string') {
      return segment;
    }

    if (typeof segment.text === 'string') {
      return segment.text;
    }

    if (Array.isArray(segment.content)) {
      return segment.content.map(extractText).filter(Boolean).join('\n');
    }

    return '';
  };

  const assistantText = contentBlocks
    .map(extractText)
    .filter(Boolean)
    .join('\n');

  // Convert Anthropic response to OpenAI-style format for consistency
  return {
    id: data.id,
    object: 'chat.completion',
    created: Date.now(),
    model: data.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: assistantText
      },
      finish_reason: data.stop_reason
    }],
    usage: {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    }
  };
}
