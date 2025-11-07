import crypto from 'crypto';
import { logger } from '../logger';

export interface SessionData {
  userId: string;
  userType: 'jwt' | 'app-key';
  channel: string;
  apiKeys?: {
    openai?: string;
    replicate?: string;
    elevenlabs?: string;
    anthropic?: string;
    grok?: string;
  };
  createdAt: number;
  expiresAt: number;
}

// In-memory session store
const sessionStore = new Map<string, SessionData>();

// Session configuration
const SESSION_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Clean up every 5 minutes

/**
 * Generate a secure random session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Create a new session and return the session token
 */
export function createSession(
  userId: string,
  userType: 'jwt' | 'app-key',
  channel: string = 'stable',
  apiKeys?: SessionData['apiKeys']
): string {
  const sessionToken = generateSessionToken();
  const now = Date.now();

  const sessionData: SessionData = {
    userId,
    userType,
    channel,
    apiKeys,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  };

  sessionStore.set(sessionToken, sessionData);

  logger.debug(`Created session for user ${userId}, type: ${userType}, expires in ${SESSION_DURATION_MS / 1000}s`);

  return sessionToken;
}

/**
 * Validate a session token and return session data if valid
 */
export function validateSession(sessionToken: string): SessionData | null {
  const sessionData = sessionStore.get(sessionToken);

  if (!sessionData) {
    logger.debug('Session token not found');
    return null;
  }

  // Check if session has expired
  if (Date.now() > sessionData.expiresAt) {
    logger.debug(`Session expired for user ${sessionData.userId}`);
    sessionStore.delete(sessionToken);
    return null;
  }

  return sessionData;
}

/**
 * Refresh a session's expiration time
 */
export function refreshSession(sessionToken: string): boolean {
  const sessionData = sessionStore.get(sessionToken);

  if (!sessionData) {
    return false;
  }

  // Check if session has expired
  if (Date.now() > sessionData.expiresAt) {
    sessionStore.delete(sessionToken);
    return false;
  }

  // Extend expiration
  sessionData.expiresAt = Date.now() + SESSION_DURATION_MS;
  logger.debug(`Refreshed session for user ${sessionData.userId}`);

  return true;
}

/**
 * Revoke a session (logout)
 */
export function revokeSession(sessionToken: string): boolean {
  return sessionStore.delete(sessionToken);
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [token, data] of sessionStore.entries()) {
    if (now > data.expiresAt) {
      sessionStore.delete(token);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug(`Cleaned up ${cleanedCount} expired session(s)`);
  }
}

/**
 * Get session store stats (for monitoring)
 */
export function getSessionStats() {
  const now = Date.now();
  let activeCount = 0;
  let expiredCount = 0;

  for (const data of sessionStore.values()) {
    if (now > data.expiresAt) {
      expiredCount++;
    } else {
      activeCount++;
    }
  }

  return {
    total: sessionStore.size,
    active: activeCount,
    expired: expiredCount,
  };
}

// Start cleanup interval
setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);

logger.info(`Session management initialized (duration: ${SESSION_DURATION_MS / 1000}s, cleanup: ${CLEANUP_INTERVAL_MS / 1000}s)`);
