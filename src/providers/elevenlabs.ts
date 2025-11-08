import fetch from 'node-fetch';
import { logger } from '../logger';
import { keepAliveAgent } from '../httpClient';

interface ElevenLabsMusicParams {
  prompt: string;
  duration?: number;
  key: string;
}

interface ElevenLabsMusicResponse {
  audio_url?: string;
  audio_base64?: string;
  generation_id: string;
  status: 'completed' | 'processing' | 'failed';
  error?: string;
}

export async function elevenLabsGenerateMusic(params: ElevenLabsMusicParams): Promise<ElevenLabsMusicResponse> {
  const { prompt, duration = 30, key } = params;

  logger.debug(`ElevenLabs generating music: "${prompt.substring(0, 50)}..." (${duration}s)`);

  // ElevenLabs Music Generation API endpoint
  const response = await fetch('https://api.elevenlabs.io/v1/music-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: duration,
      prompt_influence: 0.3
    }),
    agent: keepAliveAgent
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error(`ElevenLabs error: ${error}`);
    throw new Error(`ElevenLabs API error: ${response.status} ${error}`);
  }

  const result = await response.json() as any;
  logger.debug(`ElevenLabs music generated successfully`);

  // ElevenLabs returns audio data directly or as a URL depending on the endpoint
  // We'll normalize the response format
  return {
    audio_url: result.audio_url,
    audio_base64: result.audio,
    generation_id: result.id || `gen_${Date.now()}`,
    status: 'completed'
  };
}

// Alternative endpoint for text-to-speech if needed
export async function elevenLabsTextToSpeech(params: {
  text: string;
  voice_id: string;
  key: string;
}): Promise<Buffer> {
  const { text, voice_id, key } = params;

  logger.debug(`ElevenLabs text-to-speech: "${text.substring(0, 50)}..." with voice: ${voice_id}`);

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5'
    }),
    agent: keepAliveAgent
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} ${error}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
