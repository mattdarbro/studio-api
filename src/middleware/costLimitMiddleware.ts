import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { checkCostLimits } from '../services/costLimits';
import { logger } from '../logger';

/**
 * Middleware to check user cost limits before processing expensive operations
 * Prevents runaway API spending by enforcing daily/weekly/monthly caps
 */
export const costLimitMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authReq = req as AuthenticatedRequest;

  // Skip cost checks for non-API endpoints
  const exemptPaths = ['/health', '/ready', '/v1/validate', '/v1/models', '/v1/analytics'];
  if (exemptPaths.some(path => authReq.path.startsWith(path))) {
    next();
    return;
  }

  // Only check cost limits for authenticated users
  if (!authReq.user?.id) {
    next();
    return;
  }

  try {
    const limitCheck = checkCostLimits(authReq.user.id, authReq.appId);

    if (limitCheck && limitCheck.exceeded) {
      logger.warn(`Cost limit exceeded for user ${authReq.user.id}: ${limitCheck.period} limit`);

      res.status(429).json({
        error: 'Cost limit exceeded',
        message: `You have exceeded your ${limitCheck.period} spending limit`,
        period: limitCheck.period,
        limit: limitCheck.limit,
        current: limitCheck.current,
        remaining: 0,
        resetInfo: getResetInfo(limitCheck.period)
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Cost limit check error:', error);
    // Don't block requests on cost limit check errors - fail open for availability
    next();
  }
};

/**
 * Helper to provide reset time information
 */
function getResetInfo(period: string): string {
  const now = new Date();

  switch (period) {
    case 'daily':
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      return `Resets at ${tomorrow.toISOString()}`;

    case 'weekly':
      const nextWeek = new Date(now);
      nextWeek.setDate(now.getDate() + (7 - now.getDay()));
      nextWeek.setHours(0, 0, 0, 0);
      return `Resets at ${nextWeek.toISOString()}`;

    case 'monthly':
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return `Resets at ${nextMonth.toISOString()}`;

    default:
      return 'Unknown reset time';
  }
}
