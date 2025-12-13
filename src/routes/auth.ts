import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { verifyAppleToken, isAppleAuthConfigured } from '../services/appleAuth';
import { findOrCreateAppleUser, getUserById, getUserStats } from '../db/database';
import { createSession, refreshSession, revokeSession, getSessionStats } from '../services/validation';

const router = Router();

/**
 * POST /v1/auth/apple
 *
 * Sign in with Apple - exchange Apple identity token for session token
 *
 * Request body:
 *   - identityToken: string (required) - The identity token from Sign in with Apple
 *   - appId: string (optional) - Your app identifier (e.g., "local-poet", "merv", "dale", "panno")
 *
 * Response:
 *   - sessionToken: string - Use this for all subsequent API calls
 *   - expiresIn: number - Seconds until token expires (900 = 15 min)
 *   - user: { id, email?, isNewUser }
 */
router.post('/apple', async (req: Request, res: Response) => {
  try {
    const { identityToken, appId } = req.body;

    if (!identityToken) {
      res.status(400).json({
        error: 'Missing identityToken',
        hint: 'Send the identity token from Sign in with Apple'
      });
      return;
    }

    // Check if Apple auth is configured
    if (!isAppleAuthConfigured()) {
      logger.warn('Apple auth attempted but no bundle IDs configured');
      // Still allow in development - just log a warning
      if (process.env.NODE_ENV === 'production') {
        res.status(503).json({
          error: 'Apple Sign-In not configured',
          hint: 'Set APPLE_BUNDLE_IDS environment variable'
        });
        return;
      }
    }

    // Verify the Apple token
    const result = await verifyAppleToken(identityToken);

    if (!result.success || !result.userId) {
      res.status(401).json({
        error: result.error || 'Invalid Apple token',
        hint: 'Make sure you are sending a valid, non-expired identity token'
      });
      return;
    }

    // Find or create user in database
    const user = findOrCreateAppleUser(result.userId, result.email, appId);

    // Check if user is active
    if (!user.isActive) {
      res.status(403).json({
        error: 'Account disabled',
        hint: 'Contact support if you believe this is an error'
      });
      return;
    }

    // Create a session token
    const sessionToken = createSession(
      user.id,
      'jwt', // userType - using 'jwt' since it's a real user auth
      'stable', // default channel
      undefined, // no API keys stored in session
      appId
    );

    const isNewUser = user.loginCount === 1;

    logger.info(`Apple auth: user ${user.id}, app: ${appId || 'unknown'}, new: ${isNewUser}`);

    // Get API keys for this app (app-specific keys fall back to main keys)
    const anthropicKey = process.env.ANTHROPIC_API_KEY_LOCAL_POET || process.env.ANTHROPIC_API_KEY;
    const replicateKey = process.env.REPLICATE_API_KEY_LOCAL_POET || process.env.REPLICATE_API_KEY;
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY_LOCAL_POET || process.env.ELEVENLABS_API_KEY;

    res.json({
      sessionToken,
      expiresIn: 900, // 15 minutes in seconds
      user: {
        id: user.id,
        email: user.email,
        isNewUser,
      },
      apiKeys: {
        anthropic: anthropicKey,
        replicate: replicateKey,
        elevenLabs: elevenLabsKey,
      },
    });
  } catch (error: any) {
    logger.error('Apple auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * POST /v1/auth/refresh
 *
 * Refresh an existing session token to extend its expiration
 *
 * Headers:
 *   - x-session-token: string (required)
 *
 * Response:
 *   - success: boolean
 *   - expiresIn: number - Seconds until token expires
 */
router.post('/refresh', (req: Request, res: Response) => {
  try {
    const sessionToken = req.headers['x-session-token'] as string;

    if (!sessionToken) {
      res.status(400).json({
        error: 'Missing session token',
        hint: 'Include x-session-token header'
      });
      return;
    }

    const success = refreshSession(sessionToken);

    if (!success) {
      res.status(401).json({
        error: 'Invalid or expired session',
        hint: 'Sign in again to get a new session'
      });
      return;
    }

    res.json({
      success: true,
      expiresIn: 900,
    });
  } catch (error: any) {
    logger.error('Session refresh error:', error);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

/**
 * POST /v1/auth/logout
 *
 * Revoke the current session
 *
 * Headers:
 *   - x-session-token: string (required)
 */
router.post('/logout', (req: Request, res: Response) => {
  try {
    const sessionToken = req.headers['x-session-token'] as string;

    if (!sessionToken) {
      res.status(400).json({ error: 'Missing session token' });
      return;
    }

    revokeSession(sessionToken);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * GET /v1/auth/status
 *
 * Get auth system status (for admin/debugging)
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const sessionStats = getSessionStats();
    const userStats = getUserStats();

    res.json({
      appleAuthConfigured: isAppleAuthConfigured(),
      sessions: sessionStats,
      users: userStats,
    });
  } catch (error: any) {
    logger.error('Auth status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

export default router;
