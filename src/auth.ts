import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logger } from './logger';
import { validateSession } from './services/validation';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    [key: string]: any;
  };
  channel: string;
  appId?: string;
  apiKeys?: {
    openai?: string;
    replicate?: string;
    elevenlabs?: string;
    anthropic?: string;
    grok?: string;
  };
}

// JWT payload interface for type safety
interface JWTPayload {
  userId?: string;
  sub?: string;
  [key: string]: any;
}

/**
 * Timing-safe string comparison to prevent timing attacks
 * Returns true if strings are equal, false otherwise
 */
function timingSafeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;

  // Convert to buffers for timing-safe comparison
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // If lengths don't match, still do comparison to prevent timing leak
  if (bufferA.length !== bufferB.length) {
    // Compare against a dummy buffer of the same length as b to maintain constant time
    crypto.timingSafeEqual(bufferB, bufferB);
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

export const authMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authReq = req as AuthenticatedRequest;

  try {
    const sessionToken = authReq.headers['x-session-token'] as string | undefined;
    const authHeader = authReq.headers.authorization;
    const appKey = authReq.headers['x-app-key'] as string | undefined;
    const appId = authReq.headers['x-app-id'] as string | undefined;
    const channel = (authReq.headers['x-model-channel'] as string) || 'stable';
    const userOpenAIKey = authReq.headers['x-user-openai-key'] as string | undefined;
    const userReplicateKey = authReq.headers['x-user-replicate-key'] as string | undefined;
    const userElevenLabsKey = authReq.headers['x-user-elevenlabs-key'] as string | undefined;
    const userAnthropicKey = authReq.headers['x-user-anthropic-key'] as string | undefined;
    const userGrokKey = authReq.headers['x-user-grok-key'] as string | undefined;

    // FAST PATH: Check for session token first (Map lookup - no crypto)
    if (sessionToken) {
      const sessionData = validateSession(sessionToken);

      if (sessionData) {
        // Session is valid - use session data
        authReq.user = { id: sessionData.userId, type: sessionData.userType };
        authReq.channel = sessionData.channel;
        authReq.appId = sessionData.appId;
        authReq.apiKeys = sessionData.apiKeys || {};

        logger.debug(`Session auth: user ${sessionData.userId}, appId: ${sessionData.appId || 'none'}, channel: ${sessionData.channel}`);
        next();
        return;
      } else {
        // Session token provided but invalid/expired
        res.status(401).json({ error: 'Invalid or expired session token' });
        return;
      }
    }

    // SLOW PATH: Fall back to traditional JWT/app-key authentication
    authReq.channel = channel;
    authReq.appId = appId;

    // Store user-provided API keys separately for each service
    authReq.apiKeys = {};
    if (userOpenAIKey) {
      authReq.apiKeys.openai = userOpenAIKey;
    }
    if (userReplicateKey) {
      authReq.apiKeys.replicate = userReplicateKey;
    }
    if (userElevenLabsKey) {
      authReq.apiKeys.elevenlabs = userElevenLabsKey;
    }
    if (userAnthropicKey) {
      authReq.apiKeys.anthropic = userAnthropicKey;
    }
    if (userGrokKey) {
      authReq.apiKeys.grok = userGrokKey;
    }

    // Check for app key authentication
    if (appKey) {
      const validAppKey = process.env.APP_KEY;
      if (!validAppKey) {
        res.status(500).json({ error: 'Server configuration error: APP_KEY not set' });
        return;
      }

      // Use timing-safe comparison to prevent timing attacks
      if (timingSafeCompare(appKey, validAppKey)) {
        authReq.user = { id: 'app', type: 'app-key' };
        logger.debug(`Authenticated via app-key, appId: ${appId || 'none'}, channel: ${channel}`);
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
        const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
        const userId = decoded.userId || decoded.sub || 'unknown';
        authReq.user = { id: userId, ...decoded };
        logger.debug(`Authenticated user: ${userId}, appId: ${appId || 'none'}, channel: ${channel}`);
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
