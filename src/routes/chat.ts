import { Router, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { openaiChat } from '../providers/openai';
import { anthropicChat } from '../providers/anthropic';
import { grokChat } from '../providers/grok';
import { logger } from '../logger';

const router = Router();

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  kind?: string;
}

router.post('/', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { messages, kind = 'chat.default' } = req.body as ChatRequestBody;

    // Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required and must not be empty' });
      return;
    }

    // Resolve model configuration
    const modelConfig = resolveModel(kind, req.channel);
    logger.debug(`User ${req.user?.id}, kind: ${kind}, provider: ${modelConfig.provider}, model: ${modelConfig.model}`);

    // Call the appropriate provider
    if (modelConfig.provider === 'openai') {
      const apiKey = req.apiKeys?.openai || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'No OpenAI API key available' });
        return;
      }

      const result = await openaiChat({
        model: modelConfig.model,
        messages,
        key: apiKey
      });

      res.json(result);
    } else if (modelConfig.provider === 'anthropic') {
      const apiKey = req.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'No Anthropic API key available' });
        return;
      }

      const result = await anthropicChat({
        model: modelConfig.model,
        messages,
        key: apiKey
      });

      res.json(result);
    } else if (modelConfig.provider === 'grok') {
      const apiKey = req.apiKeys?.grok || process.env.GROK_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'No Grok API key available' });
        return;
      }

      const result = await grokChat({
        model: modelConfig.model,
        messages,
        key: apiKey
      });

      res.json(result);
    } else {
      res.status(400).json({ error: `Unsupported provider: ${modelConfig.provider}` });
    }
  } catch (error: any) {
    logger.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
