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

  // Create hosted_images table for image hosting service
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosted_images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      replicate_prediction_id TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      content_type TEXT DEFAULT 'image/png',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      accessed_at TEXT,
      expires_at TEXT
    )
  `);

  // Create indexes for hosted_images table
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_hosted_user_id ON hosted_images(user_id);
    CREATE INDEX IF NOT EXISTS idx_hosted_created_at ON hosted_images(created_at);
    CREATE INDEX IF NOT EXISTS idx_hosted_prediction_id ON hosted_images(replicate_prediction_id);
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
 * Hosted Images Database Operations
 */

export interface HostedImage {
  id: string;
  userId: string;
  replicatePredictionId?: string;
  filePath: string;
  fileSize: number;
  contentType: string;
  createdAt: Date;
  accessedAt?: Date;
  expiresAt?: Date;
}

/**
 * Insert a hosted image record
 */
export function insertHostedImage(image: {
  id: string;
  userId: string;
  replicatePredictionId?: string;
  filePath: string;
  fileSize: number;
  contentType?: string;
}): void {
  const stmt = db.prepare(`
    INSERT INTO hosted_images (
      id, user_id, replicate_prediction_id, file_path, file_size, content_type
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    image.id,
    image.userId,
    image.replicatePredictionId || null,
    image.filePath,
    image.fileSize,
    image.contentType || 'image/png'
  );
}

/**
 * Get a hosted image record by ID
 */
export function getHostedImage(id: string): HostedImage | null {
  const stmt = db.prepare('SELECT * FROM hosted_images WHERE id = ?');
  const row = stmt.get(id) as any;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    replicatePredictionId: row.replicate_prediction_id,
    filePath: row.file_path,
    fileSize: row.file_size,
    contentType: row.content_type,
    createdAt: new Date(row.created_at),
    accessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
  };
}

/**
 * Update accessed_at timestamp for an image
 */
export function updateImageAccessTime(id: string): void {
  const stmt = db.prepare('UPDATE hosted_images SET accessed_at = ? WHERE id = ?');
  stmt.run(new Date().toISOString(), id);
}

/**
 * Get all hosted images for a user
 */
export function getUserHostedImages(userId: string): HostedImage[] {
  const stmt = db.prepare('SELECT * FROM hosted_images WHERE user_id = ? ORDER BY created_at DESC');
  const rows = stmt.all(userId) as any[];

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    replicatePredictionId: row.replicate_prediction_id,
    filePath: row.file_path,
    fileSize: row.file_size,
    contentType: row.content_type,
    createdAt: new Date(row.created_at),
    accessedAt: row.accessed_at ? new Date(row.accessed_at) : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
  }));
}

/**
 * Delete a hosted image record
 */
export function deleteHostedImage(id: string): void {
  const stmt = db.prepare('DELETE FROM hosted_images WHERE id = ?');
  stmt.run(id);
}

/**
 * Delete hosted images older than specified date
 */
export function deleteOldHostedImages(olderThan: Date): number {
  const stmt = db.prepare('DELETE FROM hosted_images WHERE created_at < ?');
  const result = stmt.run(olderThan.toISOString());
  return result.changes;
}

/**
 * Get hosted image statistics
 */
export function getHostedImageStats(): {
  totalImages: number;
  totalSizeBytes: number;
  userCount: number;
} {
  const totalImages = db.prepare('SELECT COUNT(*) as count FROM hosted_images').get() as any;
  const totalSize = db.prepare('SELECT COALESCE(SUM(file_size), 0) as size FROM hosted_images').get() as any;
  const userCount = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM hosted_images').get() as any;

  return {
    totalImages: totalImages.count,
    totalSizeBytes: totalSize.size,
    userCount: userCount.count
  };
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
