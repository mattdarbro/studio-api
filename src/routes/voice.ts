import { Router, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { elevenLabsTextToSpeech } from '../providers/elevenlabs';
import { openaiTextToSpeech } from '../providers/openai';
import { logger } from '../logger';

const router = Router();

interface VoiceRequestBody {
  text: string;
  voice_id?: string;  // For ElevenLabs
  voice?: string;     // For OpenAI
  kind?: string;
  apply_text_normalization?: 'auto' | 'on' | 'off';  // ElevenLabs only
}

// POST /v1/voice - Generate speech from text
router.post('/', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      text,
      voice_id = '21m00Tcm4TlvDq8ikWAM', // Default ElevenLabs voice ID (Rachel)
      voice = 'alloy', // Default OpenAI voice
      kind = 'voice.default',
      apply_text_normalization
    } = req.body as VoiceRequestBody;

    // Validate request
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'text is required and must be a non-empty string' });
      return;
    }

    if (text.length > 5000) {
      res.status(400).json({ error: 'text must be less than 5000 characters' });
      return;
    }

    // Resolve model configuration
    const modelConfig = resolveModel(kind, req.channel);
    logger.debug(`User ${req.user?.id}, kind: ${kind}, provider: ${modelConfig.provider}, model: ${modelConfig.model}`);

    let audioBuffer: Buffer;
    let responseData: any;

    if (modelConfig.provider === 'openai') {
      // Use OpenAI TTS
      const apiKey = req.apiKeys?.openai || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'No OpenAI API key available' });
        return;
      }

      audioBuffer = await openaiTextToSpeech({
        model: modelConfig.model,
        text,
        voice,
        key: apiKey
      });

      responseData = {
        audio_base64: audioBuffer.toString('base64'),
        format: 'mp3',
        voice,
        provider: 'openai',
        model: modelConfig.model,
        text_length: text.length
      };

    } else if (modelConfig.provider === 'elevenlabs') {
      // Use ElevenLabs TTS
      const apiKey = req.apiKeys?.elevenlabs || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'No ElevenLabs API key available' });
        return;
      }

      audioBuffer = await elevenLabsTextToSpeech({
        text,
        voice_id,
        key: apiKey,
        apply_text_normalization
      });

      responseData = {
        audio_base64: audioBuffer.toString('base64'),
        format: 'mp3',
        voice_id,
        provider: 'elevenlabs',
        model: modelConfig.model,
        text_length: text.length
      };

    } else {
      res.status(400).json({ error: `Voice generation kind "${kind}" uses unsupported provider: ${modelConfig.provider}` });
      return;
    }

    res.json(responseData);
  } catch (error: any) {
    logger.error('Voice error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
