import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

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
      console.log(`[RATE_LIMIT] User ${userId} exceeded limit: ${entry.count}/${REQUESTS_PER_MINUTE}`);
      res.status(429).json({
        error: 'Rate limit exceeded',
        resetInSeconds
      });
      return;
    }

    console.log(`[RATE_LIMIT] User ${userId}: ${entry.count}/${REQUESTS_PER_MINUTE} requests`);

    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance on each request
      const keysToDelete: string[] = [];
      rateLimitMap.forEach((value, key) => {
        if (now > value.resetTime + WINDOW_MS) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => rateLimitMap.delete(key));
    }

    next();
  } catch (error) {
    console.error('[RATE_LIMIT] Error:', error);
    res.status(500).json({ error: 'Rate limit error' });
  }
};
