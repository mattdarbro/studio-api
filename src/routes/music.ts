import { Router, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { elevenLabsGenerateMusic } from '../providers/elevenlabs';

const router = Router();

interface MusicRequestBody {
  prompt: string;
  kind?: string;
  duration?: number;
}

// POST /v1/music - Generate music
router.post('/', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      prompt,
      kind = 'music.default',
      duration = 30
    } = req.body as MusicRequestBody;

    // Validate request
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
      return;
    }

    if (duration < 1 || duration > 300) {
      res.status(400).json({ error: 'duration must be between 1 and 300 seconds' });
      return;
    }

    // Resolve model configuration
    const modelConfig = resolveModel(kind, req.channel);
    console.log(`[MUSIC] User ${req.user?.id}, kind: ${kind}, provider: ${modelConfig.provider}, model: ${modelConfig.model}`);

    if (modelConfig.provider !== 'elevenlabs') {
      res.status(400).json({ error: `Music generation kind "${kind}" does not use elevenlabs provider` });
      return;
    }

    // Determine API key to use
    const apiKey = req.apiKeys?.elevenlabs || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No ElevenLabs API key available' });
      return;
    }

    // Generate music
    const result = await elevenLabsGenerateMusic({
      prompt,
      duration,
      key: apiKey
    });

    res.json({
      generation_id: result.generation_id,
      status: result.status,
      audio_url: result.audio_url,
      audio_base64: result.audio_base64,
      error: result.error
    });
  } catch (error: any) {
    console.error('[MUSIC] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
