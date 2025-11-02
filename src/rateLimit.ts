import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { logger } from './logger';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

const REQUESTS_PER_MINUTE = 120;
const WINDOW_MS = 60 * 1000; // 60 seconds

export const rateLimitMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    const userId = req.user?.id || 'anonymous';
    const now = Date.now();

    // Get or create rate limit entry
    let entry = rateLimitMap.get(userId);

    if (!entry || now > entry.resetTime) {
      // Create new window
      entry = {
        count: 0,
        resetTime: now + WINDOW_MS
      };
      rateLimitMap.set(userId, entry);
    }

    // Increment request count
    entry.count++;

    // Check if limit exceeded
    if (entry.count > REQUESTS_PER_MINUTE) {
      const resetInSeconds = Math.ceil((entry.resetTime - now) / 1000);
      logger.warn(`User ${userId} exceeded rate limit: ${entry.count}/${REQUESTS_PER_MINUTE}`);
      res.status(429).json({
        error: 'Rate limit exceeded',
        resetInSeconds
      });
      return;
    }

    logger.debug(`User ${userId}: ${entry.count}/${REQUESTS_PER_MINUTE} requests`);

    next();
  } catch (error) {
    logger.error('Rate limit error:', error);
    res.status(500).json({ error: 'Rate limit error' });
  }
};

// Clean up old entries every 5 minutes (more efficient than random cleanup)
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  rateLimitMap.forEach((value, key) => {
    if (now > value.resetTime + WINDOW_MS) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => rateLimitMap.delete(key));
  if (keysToDelete.length > 0) {
    logger.debug(`Cleaned up ${keysToDelete.length} expired rate limit entries`);
  }
}, 5 * 60 * 1000);
