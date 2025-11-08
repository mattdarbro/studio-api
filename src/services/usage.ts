import { logger } from '../logger';
import { insertUsageLog, insertUsageLogsBatch, queryUsageLogs as dbQueryUsageLogs, getTotalLogCount } from '../db/database';

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
 * In-memory buffer for pending writes to database
 * Logs accumulate here and are flushed periodically
 */
const pendingLogs: UsageLog[] = [];
const BATCH_SIZE = 100; // Flush to DB after 100 logs
const FLUSH_INTERVAL = 10000; // Or flush every 10 seconds

/**
 * Flush pending logs to database
 */
function flushPendingLogs(): void {
  if (pendingLogs.length === 0) return;

  try {
    insertUsageLogsBatch([...pendingLogs]);
    logger.debug(`Flushed ${pendingLogs.length} logs to database`);
    pendingLogs.length = 0; // Clear buffer
  } catch (error) {
    logger.error('Failed to flush logs to database:', error);
  }
}

/**
 * Log a usage event
 */
export function logUsage(log: UsageLog): void {
  // Add to pending buffer
  pendingLogs.push(log);

  // Flush if batch size reached
  if (pendingLogs.length >= BATCH_SIZE) {
    flushPendingLogs();
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
 * Set up periodic flush timer
 */
setInterval(() => {
  if (pendingLogs.length > 0) {
    logger.debug('Periodic flush of pending logs');
    flushPendingLogs();
  }
}, FLUSH_INTERVAL);

/**
 * Get all usage logs (from database)
 */
export function getAllLogs(): UsageLog[] {
  return dbQueryUsageLogs({ limit: 10000 });
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
  // Convert Date objects to ISO strings for database query
  const dbFilters: any = {
    ...filters,
    startDate: filters.startDate?.toISOString(),
    endDate: filters.endDate?.toISOString(),
  };

  return dbQueryUsageLogs(dbFilters);
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
  // Clear pending logs
  pendingLogs.length = 0;

  // This would need to be implemented in database.ts to clear DB
  logger.warn('clearLogs() called - this only clears pending buffer. Use database.clearAllLogs() to clear database');
  return 0;
}

/**
 * Get total log count
 */
export function getLogCount(): number {
  return getTotalLogCount();
}

/**
 * Flush any pending logs (for graceful shutdown)
 */
export function flushPending(): void {
  flushPendingLogs();
}

logger.info('Usage tracking service initialized (database-backed)');
