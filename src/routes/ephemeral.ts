import { Router, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { openaiRealtimeSession } from '../providers/openai';
import { logger } from '../logger';

const router = Router();

router.get('/', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const kind = 'realtime.default';

    // Resolve model configuration
    const modelConfig = resolveModel(kind, req.channel);
    logger.debug(`User ${req.user?.id}, provider: ${modelConfig.provider}, model: ${modelConfig.model}`);

    // Determine API key to use
    const apiKey = req.apiKeys?.openai || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No OpenAI API key available' });
      return;
    }

    // Call the appropriate provider
    if (modelConfig.provider === 'openai') {
      const result = await openaiRealtimeSession({
        model: modelConfig.model,
        key: apiKey
      });

      // Return the client_secret (ephemeral token)
      res.json(result);
    } else {
      res.status(400).json({ error: `Unsupported provider: ${modelConfig.provider}` });
    }
  } catch (error: any) {
    logger.error('Ephemeral error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
