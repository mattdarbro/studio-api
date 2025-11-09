import { Router, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { elevenLabsTextToSpeech } from '../providers/elevenlabs';
import { logger } from '../logger';

const router = Router();

interface VoiceRequestBody {
  text: string;
  voice_id?: string;
  kind?: string;
}

// POST /v1/voice - Generate speech from text
router.post('/', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      text,
      voice_id = '21m00Tcm4TlvDq8ikWAM', // Default voice ID (Rachel)
      kind = 'voice.default'
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

    if (modelConfig.provider !== 'elevenlabs') {
      res.status(400).json({ error: `Voice generation kind "${kind}" does not use elevenlabs provider` });
      return;
    }

    // Determine API key to use
    const apiKey = req.apiKeys?.elevenlabs || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No ElevenLabs API key available' });
      return;
    }

    // Generate speech
    const audioBuffer = await elevenLabsTextToSpeech({
      text,
      voice_id,
      key: apiKey
    });

    // Return audio as base64
    const audioBase64 = audioBuffer.toString('base64');
    res.json({
      audio_base64: audioBase64,
      format: 'mp3',
      voice_id,
      text_length: text.length
    });
  } catch (error: any) {
    logger.error('Voice error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
