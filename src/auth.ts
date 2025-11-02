import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from './logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    [key: string]: any;
  };
  channel: string;
  apiKeys?: {
    openai?: string;
    replicate?: string;
    elevenlabs?: string;
    anthropic?: string;
    grok?: string;
  };
}

export const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    const appKey = req.headers['x-app-key'] as string | undefined;
    const channel = (req.headers['x-model-channel'] as string) || 'stable';
    const userOpenAIKey = req.headers['x-user-openai-key'] as string | undefined;
    const userReplicateKey = req.headers['x-user-replicate-key'] as string | undefined;
    const userElevenLabsKey = req.headers['x-user-elevenlabs-key'] as string | undefined;
    const userAnthropicKey = req.headers['x-user-anthropic-key'] as string | undefined;
    const userGrokKey = req.headers['x-user-grok-key'] as string | undefined;

    req.channel = channel;

    // Store user-provided API keys separately for each service
    req.apiKeys = {};
    if (userOpenAIKey) {
      req.apiKeys.openai = userOpenAIKey;
    }
    if (userReplicateKey) {
      req.apiKeys.replicate = userReplicateKey;
    }
    if (userElevenLabsKey) {
      req.apiKeys.elevenlabs = userElevenLabsKey;
    }
    if (userAnthropicKey) {
      req.apiKeys.anthropic = userAnthropicKey;
    }
    if (userGrokKey) {
      req.apiKeys.grok = userGrokKey;
    }

    // Check for app key authentication
    if (appKey) {
      const validAppKey = process.env.APP_KEY;
      if (!validAppKey) {
        res.status(500).json({ error: 'Server configuration error: APP_KEY not set' });
        return;
      }

      if (appKey === validAppKey) {
        req.user = { id: 'app', type: 'app-key' };
        logger.debug(`Authenticated via app-key, channel: ${channel}`);
        next();
        return;
      } else {
        res.status(401).json({ error: 'Invalid app key' });
        return;
      }
    }

    // Check for JWT authentication
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const jwtSecret = process.env.APP_JWT_SECRET;

      if (!jwtSecret) {
        res.status(500).json({ error: 'Server configuration error: APP_JWT_SECRET not set' });
        return;
      }

      try {
        const decoded = jwt.verify(token, jwtSecret) as any;
        req.user = decoded;
        logger.debug(`Authenticated user: ${decoded.id || 'unknown'}, channel: ${channel}`);
        next();
        return;
      } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
    }

    // No valid authentication found
    res.status(401).json({ error: 'Authentication required: provide Bearer token or x-app-key header' });
  } catch (error) {
    logger.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};
