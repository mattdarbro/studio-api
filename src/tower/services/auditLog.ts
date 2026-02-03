import crypto from 'crypto';
import { logger } from '../../logger';
import { AuditEntry } from '../types';

/**
 * In-memory audit log
 * Stores recent activity for review
 * Limited to last 1000 entries to prevent memory issues
 */
const auditLog: AuditEntry[] = [];
const MAX_ENTRIES = 1000;

/**
 * Add an entry to the audit log
 */
export function logAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
  const fullEntry: AuditEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry
  };

  auditLog.unshift(fullEntry); // Add to beginning (most recent first)

  // Trim to max size
  if (auditLog.length > MAX_ENTRIES) {
    auditLog.length = MAX_ENTRIES;
  }

  logger.debug(`Tower audit: ${entry.agent} - ${entry.capability} - ${entry.success ? 'success' : 'failed'}`);

  return fullEntry;
}

/**
 * Get recent audit entries
 */
export function getAuditEntries(options?: {
  agent?: string;
  capability?: string;
  limit?: number;
  since?: string;
}): AuditEntry[] {
  let entries = [...auditLog];

  // Filter by agent
  if (options?.agent) {
    entries = entries.filter(e => e.agent === options.agent);
  }

  // Filter by capability
  if (options?.capability) {
    entries = entries.filter(e => e.capability === options.capability);
  }

  // Filter by time
  if (options?.since) {
    const sinceTime = new Date(options.since).getTime();
    entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
  }

  // Limit results
  if (options?.limit && options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Get a human-readable summary of recent activity
 */
export function getAuditSummary(agent?: string): string {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);

  let entries = auditLog.filter(
    e => new Date(e.timestamp).getTime() >= oneHourAgo
  );

  if (agent) {
    entries = entries.filter(e => e.agent === agent);
  }

  if (entries.length === 0) {
    return agent
      ? `${agent} has been quiet for the past hour.`
      : 'No activity in the past hour.';
  }

  const totalRequests = entries.length;
  const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
  const totalDuration = entries.reduce((sum, e) => sum + e.duration_ms, 0);
  const successCount = entries.filter(e => e.success).length;
  const failCount = totalRequests - successCount;

  const capabilities = new Set(entries.map(e => e.capability));
  const capabilityList = Array.from(capabilities).join(', ');

  const durationMinutes = Math.round(totalDuration / 60000);
  const agentName = agent || 'Tower agents';

  let summary = `${agentName} made ${totalRequests} request${totalRequests !== 1 ? 's' : ''} in the past hour`;

  if (failCount > 0) {
    summary += ` (${successCount} succeeded, ${failCount} failed)`;
  }

  summary += `, using ${capabilityList}`;
  summary += `, spent $${totalCost.toFixed(2)}`;

  if (durationMinutes > 0) {
    summary += `, total processing time: ${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}`;
  }

  return summary + '.';
}

/**
 * Get today's statistics
 */
export function getTodayStats(agent?: string): {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_cost: number;
  total_tokens: number;
  capabilities_used: string[];
  first_request?: string;
  last_request?: string;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();

  let entries = auditLog.filter(
    e => new Date(e.timestamp).getTime() >= todayStart
  );

  if (agent) {
    entries = entries.filter(e => e.agent === agent);
  }

  const totalRequests = entries.length;
  const successfulRequests = entries.filter(e => e.success).length;
  const failedRequests = totalRequests - successfulRequests;
  const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
  const totalTokens = entries.reduce((sum, e) => sum + (e.tokens_used || 0), 0);
  const capabilities = Array.from(new Set(entries.map(e => e.capability)));

  return {
    total_requests: totalRequests,
    successful_requests: successfulRequests,
    failed_requests: failedRequests,
    total_cost: totalCost,
    total_tokens: totalTokens,
    capabilities_used: capabilities,
    first_request: entries.length > 0 ? entries[entries.length - 1].timestamp : undefined,
    last_request: entries.length > 0 ? entries[0].timestamp : undefined
  };
}

/**
 * Clear old entries (for maintenance)
 */
export function clearOldEntries(olderThan: Date): number {
  const cutoff = olderThan.getTime();
  const initialLength = auditLog.length;

  // Remove entries older than cutoff
  for (let i = auditLog.length - 1; i >= 0; i--) {
    if (new Date(auditLog[i].timestamp).getTime() < cutoff) {
      auditLog.splice(i, 1);
    }
  }

  const removed = initialLength - auditLog.length;
  if (removed > 0) {
    logger.debug(`Tower audit: cleared ${removed} old entries`);
  }

  return removed;
}
