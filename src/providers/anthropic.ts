import { logger } from '../logger';
import { keepAliveAgent } from '../httpClient';
import { fetchWithTimeout, TIMEOUTS } from '../utils/fetchWithTimeout';

interface ImageURLContent {
  type: 'image_url';
  image_url: { url: string };
}

interface TextContent {
  type: 'text';
  text: string;
}

type ContentPart = TextContent | ImageURLContent;

interface ChatMessage {
  role: string;
  content: string | ContentPart[];
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
  const systemPrompt = systemMessages.map(m => typeof m.content === 'string' ? m.content : '').join('\n');

  // Helper to convert OpenAI image_url format to Anthropic image format
  const convertContentToAnthropic = (content: string | ContentPart[]): any[] => {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }

    // Content is an array of parts (multimodal)
    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      } else if (part.type === 'image_url') {
        // Convert OpenAI image_url format to Anthropic image format
        const url = part.image_url.url;

        // Check if it's a base64 data URL
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const mediaType = matches[1];
            const base64Data = matches[2];
            return {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            };
          }
        }

        // For regular URLs, use URL source type
        return {
          type: 'image',
          source: {
            type: 'url',
            url: url
          }
        };
      }
      return part;
    });
  };

  const anthropicMessages = nonSystemMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: convertContentToAnthropic(msg.content)
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

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody),
    agent: keepAliveAgent,
    timeout: TIMEOUTS.CHAT
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
