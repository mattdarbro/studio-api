import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../../logger';
import { TowerRequest, AgentSpend } from '../types';

/**
 * In-memory rate tracking for tower agents
 * Tracks requests per hour and per day for each agent
 */
const agentTracking = new Map<string, AgentSpend>();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Get or initialize tracking for an agent
 */
function getAgentTracking(agent: string): AgentSpend {
  const now = Date.now();
  let tracking = agentTracking.get(agent);

  if (!tracking) {
    tracking = {
      today: 0,
      requests_today: 0,
      requests_this_hour: 0,
      last_active: new Date().toISOString(),
      hourly_reset: now + HOUR_MS,
      daily_reset: now + DAY_MS
    };
    agentTracking.set(agent, tracking);
    return tracking;
  }

  // Reset hourly counter if window has passed
  if (now > tracking.hourly_reset) {
    tracking.requests_this_hour = 0;
    tracking.hourly_reset = now + HOUR_MS;
  }

  // Reset daily counters if day has passed
  if (now > tracking.daily_reset) {
    tracking.requests_today = 0;
    tracking.today = 0;
    tracking.daily_reset = now + DAY_MS;
  }

  return tracking;
}

/**
 * Tower rate limit middleware
 * Enforces per-hour and per-day request limits based on agent profile
 */
export const towerRateLimitMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const towerReq = req as TowerRequest;

  try {
    // Skip rate limiting for GET requests (status/audit)
    if (req.method === 'GET') {
      next();
      return;
    }

    if (!towerReq.tower) {
      res.status(500).json({ error: 'Tower auth not initialized' });
      return;
    }

    const { agent, profile } = towerReq.tower;
    const tracking = getAgentTracking(agent);
    const now = Date.now();

    // Check hourly limit
    if (tracking.requests_this_hour >= profile.limits.requests_per_hour) {
      const resetInSeconds = Math.ceil((tracking.hourly_reset - now) / 1000);
      logger.warn(`Tower rate limit: ${agent} exceeded hourly limit (${profile.limits.requests_per_hour})`);
      res.status(429).json({
        error: 'Hourly rate limit exceeded',
        agent,
        limit: profile.limits.requests_per_hour,
        reset_in_seconds: resetInSeconds,
        message: `Try again in ${Math.ceil(resetInSeconds / 60)} minutes`
      });
      return;
    }

    // Check daily limit
    if (tracking.requests_today >= profile.limits.requests_per_day) {
      const resetInSeconds = Math.ceil((tracking.daily_reset - now) / 1000);
      logger.warn(`Tower rate limit: ${agent} exceeded daily limit (${profile.limits.requests_per_day})`);
      res.status(429).json({
        error: 'Daily rate limit exceeded',
        agent,
        limit: profile.limits.requests_per_day,
        reset_in_seconds: resetInSeconds,
        message: `Daily limit reached. Try again tomorrow.`
      });
      return;
    }

    // Increment counters (actual tracking happens after request completes)
    tracking.requests_this_hour++;
    tracking.requests_today++;
    tracking.last_active = new Date().toISOString();

    logger.debug(`Tower rate: ${agent} - ${tracking.requests_this_hour}/${profile.limits.requests_per_hour} hourly, ${tracking.requests_today}/${profile.limits.requests_per_day} daily`);

    next();
  } catch (error) {
    logger.error('Tower rate limit error:', error);
    res.status(500).json({ error: 'Rate limit check failed' });
  }
};

/**
 * Add spend to an agent's tracking
 */
export function addAgentSpend(agent: string, amount: number): void {
  const tracking = getAgentTracking(agent);
  tracking.today += amount;
  tracking.last_active = new Date().toISOString();
}

/**
 * Get an agent's current tracking data
 */
export function getAgentTrackingData(agent: string): AgentSpend {
  return getAgentTracking(agent);
}

/**
 * Get all agent tracking data
 */
export function getAllAgentTracking(): Map<string, AgentSpend> {
  return agentTracking;
}

/**
 * Check if agent has exceeded daily spend cap
 */
export function isSpendCapExceeded(agent: string, cap: number): boolean {
  const tracking = getAgentTracking(agent);
  return tracking.today >= cap;
}

// Clean up stale entries every hour
setInterval(() => {
  const now = Date.now();
  const staleThreshold = now - (7 * DAY_MS); // Remove entries older than 7 days

  agentTracking.forEach((value, key) => {
    const lastActive = new Date(value.last_active).getTime();
    if (lastActive < staleThreshold) {
      agentTracking.delete(key);
      logger.debug(`Tower: cleaned up stale tracking for ${key}`);
    }
  });
}, HOUR_MS);
