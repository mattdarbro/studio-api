import { queryUsage } from './usage';
import { logger } from '../logger';

/**
 * Cost limit configuration (in USD)
 */
interface CostLimits {
  dailyLimit: number;   // Maximum spend per day in USD
  weeklyLimit: number;  // Maximum spend per week in USD
  monthlyLimit: number; // Maximum spend per month in USD
}

/**
 * Default cost limits (configurable via environment variables)
 */
const DEFAULT_LIMITS: CostLimits = {
  dailyLimit: parseFloat(process.env.DAILY_COST_LIMIT || '10'),   // $10/day
  weeklyLimit: parseFloat(process.env.WEEKLY_COST_LIMIT || '50'),  // $50/week
  monthlyLimit: parseFloat(process.env.MONTHLY_COST_LIMIT || '200') // $200/month
};

/**
 * Get user spending for a time period
 */
function getUserSpending(userId: string, startDate: Date): number {
  const logs = queryUsage({
    userId,
    startDate,
    endDate: new Date()
  });

  // Sum up estimated costs (stored in cents)
  const totalCents = logs.reduce((sum, log) => sum + (log.estimatedCost || 0), 0);
  return totalCents / 100; // Convert cents to dollars
}

/**
 * Check if user has exceeded cost limits
 * Returns null if within limits, or an error object if exceeded
 */
export function checkCostLimits(
  userId: string,
  appId?: string | null
): { exceeded: true; period: string; limit: number; current: number } | null {
  // Skip limit checks for anonymous users (they're already rate limited)
  if (userId === 'anonymous') {
    return null;
  }

  const now = new Date();

  // Check daily limit
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dailySpend = getUserSpending(userId, dayStart);

  if (dailySpend >= DEFAULT_LIMITS.dailyLimit) {
    logger.warn(`User ${userId} exceeded daily cost limit: $${dailySpend.toFixed(2)} >= $${DEFAULT_LIMITS.dailyLimit}`);
    return {
      exceeded: true,
      period: 'daily',
      limit: DEFAULT_LIMITS.dailyLimit,
      current: dailySpend
    };
  }

  // Check weekly limit
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
  weekStart.setHours(0, 0, 0, 0);
  const weeklySpend = getUserSpending(userId, weekStart);

  if (weeklySpend >= DEFAULT_LIMITS.weeklyLimit) {
    logger.warn(`User ${userId} exceeded weekly cost limit: $${weeklySpend.toFixed(2)} >= $${DEFAULT_LIMITS.weeklyLimit}`);
    return {
      exceeded: true,
      period: 'weekly',
      limit: DEFAULT_LIMITS.weeklyLimit,
      current: weeklySpend
    };
  }

  // Check monthly limit
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlySpend = getUserSpending(userId, monthStart);

  if (monthlySpend >= DEFAULT_LIMITS.monthlyLimit) {
    logger.warn(`User ${userId} exceeded monthly cost limit: $${monthlySpend.toFixed(2)} >= $${DEFAULT_LIMITS.monthlyLimit}`);
    return {
      exceeded: true,
      period: 'monthly',
      limit: DEFAULT_LIMITS.monthlyLimit,
      current: monthlySpend
    };
  }

  // Within all limits
  logger.debug(`User ${userId} cost check: daily=$${dailySpend.toFixed(2)}, weekly=$${weeklySpend.toFixed(2)}, monthly=$${monthlySpend.toFixed(2)}`);
  return null;
}

/**
 * Get current spending status for a user
 */
export function getCostStatus(userId: string): {
  daily: { spent: number; limit: number; remaining: number };
  weekly: { spent: number; limit: number; remaining: number };
  monthly: { spent: number; limit: number; remaining: number };
} {
  const now = new Date();

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dailySpend = getUserSpending(userId, dayStart);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weeklySpend = getUserSpending(userId, weekStart);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlySpend = getUserSpending(userId, monthStart);

  return {
    daily: {
      spent: dailySpend,
      limit: DEFAULT_LIMITS.dailyLimit,
      remaining: Math.max(0, DEFAULT_LIMITS.dailyLimit - dailySpend)
    },
    weekly: {
      spent: weeklySpend,
      limit: DEFAULT_LIMITS.weeklyLimit,
      remaining: Math.max(0, DEFAULT_LIMITS.weeklyLimit - weeklySpend)
    },
    monthly: {
      spent: monthlySpend,
      limit: DEFAULT_LIMITS.monthlyLimit,
      remaining: Math.max(0, DEFAULT_LIMITS.monthlyLimit - monthlySpend)
    }
  };
}
