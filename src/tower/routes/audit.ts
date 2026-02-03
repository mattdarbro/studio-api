import { Router, Response } from 'express';
import { logger } from '../../logger';
import { TowerRequest } from '../types';
import { getAuditEntries, getAuditSummary, getTodayStats } from '../services/auditLog';

const router = Router();

/**
 * GET /tower/audit
 *
 * Returns human-readable activity log.
 */
router.get('/', (async (req: TowerRequest, res: Response) => {
  try {
    if (!req.tower) {
      res.status(500).json({ error: 'Tower auth not initialized' });
      return;
    }

    const { agent, isAdmin } = req.tower;

    // Parse query parameters
    const limit = parseInt(req.query.limit as string) || 50;
    const since = req.query.since as string | undefined;
    const filterAgent = req.query.agent as string | undefined;
    const filterCapability = req.query.capability as string | undefined;

    // Non-admins can only see their own audit entries
    const agentFilter = isAdmin ? filterAgent : agent;

    // Get entries
    const entries = getAuditEntries({
      agent: agentFilter,
      capability: filterCapability,
      limit,
      since
    });

    // Get summary
    const summary = getAuditSummary(agentFilter);

    // Get today's stats
    const todayStats = getTodayStats(agentFilter);

    res.json({
      entries,
      summary,
      today: todayStats,
      filters: {
        agent: agentFilter,
        capability: filterCapability,
        limit,
        since
      }
    });
  } catch (error: any) {
    logger.error('Tower audit error:', error);
    res.status(500).json({ error: error.message || 'Failed to get audit log' });
  }
}) as any);

export default router;
