import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { openaiChat } from '../providers/openai';

const router = Router();

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  kind?: string;
}

router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { messages, kind = 'chat.default' } = req.body as ChatRequestBody;

    // Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required and must not be empty' });
      return;
    }

    // Resolve model configuration
    const modelConfig = resolveModel(kind, req.channel);
    console.log(`[CHAT] User ${req.user?.id}, kind: ${kind}, provider: ${modelConfig.provider}, model: ${modelConfig.model}`);

    // Determine API key to use
    const apiKey = req.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No API key available' });
      return;
    }

    // Call the appropriate provider
    if (modelConfig.provider === 'openai') {
      const result = await openaiChat({
        model: modelConfig.model,
        messages,
        key: apiKey
      });

      res.json(result);
    } else {
      res.status(400).json({ error: `Unsupported provider: ${modelConfig.provider}` });
    }
  } catch (error: any) {
    console.error('[CHAT] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
