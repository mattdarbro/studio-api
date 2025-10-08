import fetch from 'node-fetch';

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
  console.log(`[OPENAI] Making chat request with model: ${model}`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[OPENAI] Chat API error: ${response.status} - ${errorText}`);
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`[OPENAI] Chat request successful, usage: ${JSON.stringify(data.usage || {})}`);
  return data;
}

export async function openaiRealtimeSession({ model, key }: OpenAIRealtimeRequest): Promise<any> {
  console.log(`[OPENAI] Creating realtime session with model: ${model}`);

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      voice: 'alloy'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[OPENAI] Realtime API error: ${response.status} - ${errorText}`);
    throw new Error(`OpenAI Realtime API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`[OPENAI] Realtime session created successfully`);
  return data;
}
