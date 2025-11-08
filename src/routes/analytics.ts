import { Router, Request, Response } from 'express';
import { queryUsage, calculateStats, getLogCount, getAllLogs } from '../services/usage';
import { logger } from '../logger';

const router = Router();

/**
 * GET /v1/analytics/usage
 * Query usage logs with optional filters
 *
 * Query Parameters:
 * - appId: Filter by app ID
 * - userId: Filter by user ID
 * - provider: Filter by provider (openai, anthropic, etc.)
 * - endpoint: Filter by endpoint (/v1/chat, /v1/images, etc.)
 * - startDate: Start date (ISO 8601 format)
 * - endDate: End date (ISO 8601 format)
 * - limit: Maximum number of results
 * - groupBy: Group results by field (app, provider, model, endpoint)
 *
 * Requires: x-app-key header for authentication
 */
router.get('/usage', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    // Parse query parameters
    const {
      appId,
      userId,
      provider,
      endpoint,
      startDate,
      endDate,
      limit,
      groupBy,
    } = req.query;

    // Build filters
    const filters: any = {};

    if (appId) filters.appId = appId as string;
    if (userId) filters.userId = userId as string;
    if (provider) filters.provider = provider as string;
    if (endpoint) filters.endpoint = endpoint as string;
    if (limit) filters.limit = parseInt(limit as string, 10);

    // Parse dates
    if (startDate) {
      try {
        filters.startDate = new Date(startDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid startDate format (use ISO 8601)' });
        return;
      }
    }

    if (endDate) {
      try {
        filters.endDate = new Date(endDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid endDate format (use ISO 8601)' });
        return;
      }
    }

    // Query logs
    const logs = queryUsage(filters);

    // Calculate statistics
    const stats = calculateStats(logs);

    logger.debug(`Analytics query: ${logs.length} logs matched`);

    // Return results
    res.json({
      totalLogs: logs.length,
      stats,
      filters,
      // Include raw logs if requested and count is reasonable
      logs: logs.length <= 1000 ? logs : undefined,
      message: logs.length > 1000 ? 'Too many logs to return. Use filters or groupBy to aggregate.' : undefined,
    });
  } catch (error) {
    logger.error('Analytics usage error:', error);
    res.status(500).json({ error: 'Failed to query usage logs' });
  }
});

/**
 * GET /v1/analytics/costs
 * Get cost breakdown by app, provider, or model
 *
 * Query Parameters:
 * - appId: Filter by specific app
 * - startDate: Start date (ISO 8601 format)
 * - endDate: End date (ISO 8601 format)
 *
 * Requires: x-app-key header for authentication
 */
router.get('/costs', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    // Parse query parameters
    const { appId, startDate, endDate } = req.query;

    // Build filters
    const filters: any = {};
    if (appId) filters.appId = appId as string;

    if (startDate) {
      try {
        filters.startDate = new Date(startDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid startDate format' });
        return;
      }
    }

    if (endDate) {
      try {
        filters.endDate = new Date(endDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid endDate format' });
        return;
      }
    }

    // Query logs
    const logs = queryUsage(filters);
    const stats = calculateStats(logs);

    res.json({
      totalCost: stats.totalCost.toFixed(4),
      currency: 'USD',
      breakdown: {
        byProvider: stats.byProvider,
        byModel: stats.byModel,
        byApp: stats.byApp,
        byEndpoint: stats.byEndpoint,
      },
      period: {
        start: filters.startDate || 'all time',
        end: filters.endDate || 'now',
      },
      requestCount: stats.totalRequests,
    });
  } catch (error) {
    logger.error('Analytics costs error:', error);
    res.status(500).json({ error: 'Failed to calculate costs' });
  }
});

/**
 * GET /v1/analytics/apps
 * List all apps with their usage and cost statistics
 *
 * Requires: x-app-key header for authentication
 */
router.get('/apps', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    // Get all logs
    const allLogs = getAllLogs();

    // Group by app
    const appMap = new Map<string, any>();

    for (const log of allLogs) {
      const appKey = log.appId || 'unknown';

      if (!appMap.has(appKey)) {
        appMap.set(appKey, {
          appId: appKey,
          requestCount: 0,
          totalCost: 0,
          firstSeen: log.timestamp,
          lastUsed: log.timestamp,
          successfulRequests: 0,
          failedRequests: 0,
        });
      }

      const app = appMap.get(appKey);
      app.requestCount++;
      app.totalCost += log.estimatedCost / 100; // Convert cents to dollars

      if (log.timestamp < app.firstSeen) app.firstSeen = log.timestamp;
      if (log.timestamp > app.lastUsed) app.lastUsed = log.timestamp;

      if (log.statusCode >= 200 && log.statusCode < 300) {
        app.successfulRequests++;
      } else {
        app.failedRequests++;
      }
    }

    // Convert to array and sort by cost
    const apps = Array.from(appMap.values()).sort((a, b) => b.totalCost - a.totalCost);

    res.json({
      totalApps: apps.length,
      apps: apps.map((app) => ({
        ...app,
        totalCost: app.totalCost.toFixed(4),
        successRate: ((app.successfulRequests / app.requestCount) * 100).toFixed(1) + '%',
      })),
    });
  } catch (error) {
    logger.error('Analytics apps error:', error);
    res.status(500).json({ error: 'Failed to get app statistics' });
  }
});

/**
 * GET /v1/analytics/stats
 * Get overall usage statistics
 *
 * Requires: x-app-key header for authentication
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    const allLogs = getAllLogs();
    const stats = calculateStats(allLogs);

    res.json({
      totalLogs: getLogCount(),
      totalRequests: stats.totalRequests,
      totalCost: stats.totalCost.toFixed(4),
      totalDuration: stats.totalDuration,
      averageDuration: stats.totalRequests > 0 ? Math.round(stats.totalDuration / stats.totalRequests) : 0,
      successRate: stats.totalRequests > 0 ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1) + '%' : '0%',
      breakdown: {
        byProvider: stats.byProvider,
        byModel: stats.byModel,
        byApp: stats.byApp,
        byEndpoint: stats.byEndpoint,
      },
    });
  } catch (error) {
    logger.error('Analytics stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

export default router;
