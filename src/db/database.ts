import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../logger';
import { UsageLog } from '../services/usage';

// Database file location (stored in project root for persistence)
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'studio-api.db');

// Initialize database connection
const db = new Database(DB_PATH, {
  verbose: process.env.LOG_LEVEL === 'debug' ? (msg) => logger.debug(`SQL: ${msg}`) : undefined
});

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

/**
 * Initialize database schema
 */
export function initializeDatabase(): void {
  logger.info(`Initializing database at: ${DB_PATH}`);

  // Create usage_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      user_id TEXT NOT NULL,
      app_id TEXT,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      estimated_cost INTEGER DEFAULT 0,
      duration INTEGER NOT NULL,
      status_code INTEGER NOT NULL,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for fast querying
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_app_id ON usage_logs(app_id);
    CREATE INDEX IF NOT EXISTS idx_user_id ON usage_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_provider ON usage_logs(provider);
    CREATE INDEX IF NOT EXISTS idx_endpoint ON usage_logs(endpoint);
    CREATE INDEX IF NOT EXISTS idx_status_code ON usage_logs(status_code);
  `);

  logger.info('Database schema initialized');
}

/**
 * Insert a single usage log
 */
export function insertUsageLog(log: UsageLog): void {
  const stmt = db.prepare(`
    INSERT INTO usage_logs (
      timestamp, user_id, app_id, endpoint, method,
      provider, model, input_tokens, output_tokens,
      estimated_cost, duration, status_code, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    log.timestamp.toISOString(),
    log.userId,
    log.appId,
    log.endpoint,
    log.method,
    log.provider,
    log.model,
    log.inputTokens,
    log.outputTokens,
    log.estimatedCost,
    log.duration,
    log.statusCode,
    log.error
  );
}

/**
 * Insert multiple usage logs (batch insert for performance)
 */
export function insertUsageLogsBatch(logs: UsageLog[]): void {
  const insert = db.prepare(`
    INSERT INTO usage_logs (
      timestamp, user_id, app_id, endpoint, method,
      provider, model, input_tokens, output_tokens,
      estimated_cost, duration, status_code, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((logs: UsageLog[]) => {
    for (const log of logs) {
      insert.run(
        log.timestamp.toISOString(),
        log.userId,
        log.appId,
        log.endpoint,
        log.method,
        log.provider,
        log.model,
        log.inputTokens,
        log.outputTokens,
        log.estimatedCost,
        log.duration,
        log.statusCode,
        log.error
      );
    }
  });

  insertMany(logs);
}

/**
 * Query usage logs with filters
 */
export interface QueryFilters {
  appId?: string;
  userId?: string;
  provider?: string;
  endpoint?: string;
  startDate?: string; // ISO string
  endDate?: string; // ISO string
  limit?: number;
  offset?: number;
}

export function queryUsageLogs(filters: QueryFilters = {}): UsageLog[] {
  let sql = 'SELECT * FROM usage_logs WHERE 1=1';
  const params: any[] = [];

  if (filters.appId) {
    sql += ' AND app_id = ?';
    params.push(filters.appId);
  }

  if (filters.userId) {
    sql += ' AND user_id = ?';
    params.push(filters.userId);
  }

  if (filters.provider) {
    sql += ' AND provider = ?';
    params.push(filters.provider);
  }

  if (filters.endpoint) {
    sql += ' AND endpoint = ?';
    params.push(filters.endpoint);
  }

  if (filters.startDate) {
    sql += ' AND timestamp >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    sql += ' AND timestamp <= ?';
    params.push(filters.endDate);
  }

  sql += ' ORDER BY timestamp DESC';

  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }

  if (filters.offset) {
    sql += ' OFFSET ?';
    params.push(filters.offset);
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as any[];

  // Convert database rows to UsageLog objects
  return rows.map(row => ({
    timestamp: new Date(row.timestamp),
    userId: row.user_id,
    appId: row.app_id,
    endpoint: row.endpoint,
    method: row.method,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCost: row.estimated_cost,
    duration: row.duration,
    statusCode: row.status_code,
    error: row.error,
  }));
}

/**
 * Execute a custom SQL query (for AI-powered chat interface)
 * IMPORTANT: Only use with sanitized/validated SQL from AI
 */
export function executeQuery(sql: string): any[] {
  try {
    const stmt = db.prepare(sql);
    return stmt.all();
  } catch (error) {
    logger.error('SQL execution error:', error);
    throw error;
  }
}

/**
 * Get total row count
 */
export function getTotalLogCount(): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM usage_logs').get() as any;
  return result.count;
}

/**
 * Get database statistics
 */
export function getDbStats() {
  const totalLogs = getTotalLogCount();
  const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;

  return {
    totalLogs,
    dbSizeBytes: dbSize.size,
    dbSizeMB: (dbSize.size / 1024 / 1024).toFixed(2),
    dbPath: DB_PATH,
  };
}

/**
 * Clear all logs (use with caution!)
 */
export function clearAllLogs(): number {
  const result = db.prepare('DELETE FROM usage_logs').run();
  logger.warn(`Cleared ${result.changes} usage logs from database`);
  return result.changes;
}

/**
 * Get database connection status (for health checks)
 */
export function getDatabaseStatus(): { connected: boolean; error?: string } {
  try {
    // Simple query to test database connectivity
    const result = db.prepare('SELECT 1 as test').get();
    return { connected: result !== undefined };
  } catch (error: any) {
    return {
      connected: false,
      error: error.message || 'Database connection failed'
    };
  }
}

/**
 * Close database connection (for graceful shutdown)
 */
export function closeDatabase(): void {
  db.close();
  logger.info('Database connection closed');
}

// Initialize database on module load
initializeDatabase();
