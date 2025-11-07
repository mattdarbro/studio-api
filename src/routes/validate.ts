import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createSession, getSessionStats, refreshSession, revokeSession } from '../services/validation';
import { logger } from '../logger';

const router = Router();

/**
 * POST /v1/validate
 * Validates API key or JWT token and returns a session token
 *
 * Headers:
 * - Authorization: Bearer <jwt_token> (JWT authentication)
 * - x-app-key: <app_key> (App key authentication)
 * - x-model-channel: <channel> (optional, defaults to 'stable')
 * - x-user-openai-key: <key> (optional)
 * - x-user-replicate-key: <key> (optional)
 * - x-user-elevenlabs-key: <key> (optional)
 * - x-user-anthropic-key: <key> (optional)
 * - x-user-grok-key: <key> (optional)
 *
 * Response:
 * {
 *   "sessionToken": "...",
 *   "expiresIn": 900,
 *   "userId": "...",
 *   "channel": "stable"
 * }
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const appKey = req.headers['x-app-key'] as string | undefined;
    const channel = (req.headers['x-model-channel'] as string) || 'stable';

    // Extract user-provided API keys
    const apiKeys: any = {};
    if (req.headers['x-user-openai-key']) {
      apiKeys.openai = req.headers['x-user-openai-key'] as string;
    }
    if (req.headers['x-user-replicate-key']) {
      apiKeys.replicate = req.headers['x-user-replicate-key'] as string;
    }
    if (req.headers['x-user-elevenlabs-key']) {
      apiKeys.elevenlabs = req.headers['x-user-elevenlabs-key'] as string;
    }
    if (req.headers['x-user-anthropic-key']) {
      apiKeys.anthropic = req.headers['x-user-anthropic-key'] as string;
    }
    if (req.headers['x-user-grok-key']) {
      apiKeys.grok = req.headers['x-user-grok-key'] as string;
    }

    // Validate app key
    if (appKey) {
      const validAppKey = process.env.APP_KEY;
      if (!validAppKey) {
        res.status(500).json({ error: 'Server configuration error: APP_KEY not set' });
        return;
      }

      if (appKey !== validAppKey) {
        res.status(401).json({ error: 'Invalid app key' });
        return;
      }

      // Create session for app key authentication
      const sessionToken = createSession('app', 'app-key', channel, Object.keys(apiKeys).length > 0 ? apiKeys : undefined);

      logger.info(`Session created for app-key authentication, channel: ${channel}`);

      res.json({
        sessionToken,
        expiresIn: 900, // 15 minutes in seconds
        userId: 'app',
        userType: 'app-key',
        channel,
      });
      return;
    }

    // Validate JWT token
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const jwtSecret = process.env.APP_JWT_SECRET;

      if (!jwtSecret) {
        res.status(500).json({ error: 'Server configuration error: APP_JWT_SECRET not set' });
        return;
      }

      try {
        const decoded = jwt.verify(token, jwtSecret) as any;
        const userId = decoded.id || decoded.sub || 'unknown';

        // Create session for JWT authentication
        const sessionToken = createSession(userId, 'jwt', channel, Object.keys(apiKeys).length > 0 ? apiKeys : undefined);

        logger.info(`Session created for user: ${userId}, channel: ${channel}`);

        res.json({
          sessionToken,
          expiresIn: 900, // 15 minutes in seconds
          userId,
          userType: 'jwt',
          channel,
        });
        return;
      } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
    }

    // No valid authentication found
    res.status(401).json({ error: 'Authentication required: provide Bearer token or x-app-key header' });
  } catch (error) {
    logger.error('Validation error:', error);
    res.status(500).json({ error: 'Validation error' });
  }
});

/**
 * POST /v1/validate/refresh
 * Refresh an existing session token
 *
 * Headers:
 * - x-session-token: <session_token>
 */
router.post('/refresh', (req: Request, res: Response) => {
  try {
    const sessionToken = req.headers['x-session-token'] as string | undefined;

    if (!sessionToken) {
      res.status(401).json({ error: 'Session token required' });
      return;
    }

    const refreshed = refreshSession(sessionToken);

    if (!refreshed) {
      res.status(401).json({ error: 'Invalid or expired session token' });
      return;
    }

    logger.debug('Session refreshed successfully');

    res.json({
      success: true,
      expiresIn: 900,
    });
  } catch (error) {
    logger.error('Refresh error:', error);
    res.status(500).json({ error: 'Refresh error' });
  }
});

/**
 * POST /v1/validate/revoke
 * Revoke a session token (logout)
 *
 * Headers:
 * - x-session-token: <session_token>
 */
router.post('/revoke', (req: Request, res: Response) => {
  try {
    const sessionToken = req.headers['x-session-token'] as string | undefined;

    if (!sessionToken) {
      res.status(401).json({ error: 'Session token required' });
      return;
    }

    const revoked = revokeSession(sessionToken);

    logger.info('Session revoked');

    res.json({
      success: revoked,
    });
  } catch (error) {
    logger.error('Revoke error:', error);
    res.status(500).json({ error: 'Revoke error' });
  }
});

/**
 * GET /v1/validate/stats
 * Get session statistics (for monitoring/debugging)
 * Requires authentication
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    // Simple protection - only allow with valid app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const stats = getSessionStats();
    res.json(stats);
  } catch (error) {
    logger.error('Stats error:', error);
    res.status(500).json({ error: 'Stats error' });
  }
});

export default router;
