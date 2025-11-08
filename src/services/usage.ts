import { logger } from '../logger';

/**
 * Usage log entry for tracking API usage and costs
 */
export interface UsageLog {
  timestamp: Date;
  userId: string;
  appId: string | null;
  endpoint: string;
  method: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number; // In USD cents (e.g., 125 = $1.25)
  duration: number; // In milliseconds
  statusCode: number;
  error: string | null;
}

/**
 * In-memory storage for usage logs
 * Keep last 10,000 entries to prevent memory bloat
 */
const usageLogs: UsageLog[] = [];
const MAX_LOGS = 10000;

/**
 * Log a usage event
 */
export function logUsage(log: UsageLog): void {
  usageLogs.push(log);

  // Trim old logs if we exceed max
  if (usageLogs.length > MAX_LOGS) {
    const toRemove = usageLogs.length - MAX_LOGS;
    usageLogs.splice(0, toRemove);
    logger.debug(`Trimmed ${toRemove} old usage logs`);
  }

  // Log to console for debugging (can be disabled in production)
  if (process.env.LOG_LEVEL === 'debug') {
    logger.debug('Usage logged:', {
      appId: log.appId || 'none',
      endpoint: log.endpoint,
      provider: log.provider,
      cost: `$${(log.estimatedCost / 100).toFixed(4)}`,
      duration: `${log.duration}ms`,
    });
  }
}

/**
 * Get all usage logs (for debugging)
 */
export function getAllLogs(): UsageLog[] {
  return [...usageLogs]; // Return copy to prevent external modification
}

/**
 * Query usage logs with filters
 */
export interface UsageQueryFilters {
  appId?: string;
  userId?: string;
  provider?: string;
  endpoint?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export function queryUsage(filters: UsageQueryFilters = {}): UsageLog[] {
  let results = [...usageLogs];

  // Filter by appId
  if (filters.appId) {
    results = results.filter((log) => log.appId === filters.appId);
  }

  // Filter by userId
  if (filters.userId) {
    results = results.filter((log) => log.userId === filters.userId);
  }

  // Filter by provider
  if (filters.provider) {
    results = results.filter((log) => log.provider === filters.provider);
  }

  // Filter by endpoint
  if (filters.endpoint) {
    results = results.filter((log) => log.endpoint === filters.endpoint);
  }

  // Filter by date range
  if (filters.startDate) {
    results = results.filter((log) => log.timestamp >= filters.startDate!);
  }

  if (filters.endDate) {
    results = results.filter((log) => log.timestamp <= filters.endDate!);
  }

  // Apply limit
  if (filters.limit && filters.limit > 0) {
    results = results.slice(-filters.limit); // Get last N entries
  }

  return results;
}

/**
 * Calculate aggregate statistics from usage logs
 */
export interface UsageStats {
  totalRequests: number;
  totalCost: number; // In USD
  totalDuration: number; // In milliseconds
  successfulRequests: number;
  failedRequests: number;
  byProvider: Record<string, { requests: number; cost: number }>;
  byModel: Record<string, { requests: number; cost: number }>;
  byApp: Record<string, { requests: number; cost: number }>;
  byEndpoint: Record<string, { requests: number; cost: number }>;
}

export function calculateStats(logs: UsageLog[]): UsageStats {
  const stats: UsageStats = {
    totalRequests: logs.length,
    totalCost: 0,
    totalDuration: 0,
    successfulRequests: 0,
    failedRequests: 0,
    byProvider: {},
    byModel: {},
    byApp: {},
    byEndpoint: {},
  };

  for (const log of logs) {
    // Overall stats
    stats.totalCost += log.estimatedCost / 100; // Convert cents to dollars
    stats.totalDuration += log.duration;

    if (log.statusCode >= 200 && log.statusCode < 300) {
      stats.successfulRequests++;
    } else {
      stats.failedRequests++;
    }

    // By provider
    if (log.provider) {
      if (!stats.byProvider[log.provider]) {
        stats.byProvider[log.provider] = { requests: 0, cost: 0 };
      }
      stats.byProvider[log.provider].requests++;
      stats.byProvider[log.provider].cost += log.estimatedCost / 100;
    }

    // By model
    if (log.model) {
      if (!stats.byModel[log.model]) {
        stats.byModel[log.model] = { requests: 0, cost: 0 };
      }
      stats.byModel[log.model].requests++;
      stats.byModel[log.model].cost += log.estimatedCost / 100;
    }

    // By app
    const appKey = log.appId || 'unknown';
    if (!stats.byApp[appKey]) {
      stats.byApp[appKey] = { requests: 0, cost: 0 };
    }
    stats.byApp[appKey].requests++;
    stats.byApp[appKey].cost += log.estimatedCost / 100;

    // By endpoint
    if (!stats.byEndpoint[log.endpoint]) {
      stats.byEndpoint[log.endpoint] = { requests: 0, cost: 0 };
    }
    stats.byEndpoint[log.endpoint].requests++;
    stats.byEndpoint[log.endpoint].cost += log.estimatedCost / 100;
  }

  return stats;
}

/**
 * Clear all usage logs (use with caution!)
 */
export function clearLogs(): number {
  const count = usageLogs.length;
  usageLogs.length = 0;
  logger.info(`Cleared ${count} usage logs`);
  return count;
}

/**
 * Get total log count
 */
export function getLogCount(): number {
  return usageLogs.length;
}

logger.info('Usage tracking service initialized');
