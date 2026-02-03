import { Router, Response } from 'express';
import { logger } from '../../logger';
import { TowerRequest, TowerStatus } from '../types';
import { getAllAgentTracking, getAgentTrackingData } from '../middleware/rateLimiter';
import { getAllProfiles } from '../middleware/auth';
import { getTodayStats } from '../services/auditLog';

const router = Router();

/**
 * GET /tower/status
 *
 * Returns current session and spend information.
 */
router.get('/', (async (req: TowerRequest, res: Response) => {
  try {
    if (!req.tower) {
      res.status(500).json({ error: 'Tower auth not initialized' });
      return;
    }

    const { agent, isAdmin } = req.tower;
    const profiles = getAllProfiles();
    const allTracking = getAllAgentTracking();

    // Calculate overall totals
    let totalRequests = 0;
    let totalSpend = 0;

    // Build agents status
    const agents: TowerStatus['agents'] = {};

    // If admin, show all agents; otherwise just the requesting agent
    const agentsToShow = isAdmin ? Object.keys(profiles) : [agent];

    for (const agentName of agentsToShow) {
      const profile = profiles[agentName];
      if (!profile) continue;

      const tracking = getAgentTrackingData(agentName);
      const stats = getTodayStats(agentName);

      agents[agentName] = {
        requests_today: tracking.requests_today,
        requests_this_hour: tracking.requests_this_hour,
        rate_limit: profile.limits.requests_per_hour,
        spend_today: tracking.today,
        spend_cap: profile.limits.daily_spend_cap_usd,
        last_active: tracking.last_active
      };

      totalRequests += stats.total_requests;
      totalSpend += tracking.today;
    }

    // Default spend cap (use admin cap as the overall cap if admin, else agent's cap)
    const overallCap = isAdmin
      ? (profiles['matt']?.limits.daily_spend_cap_usd || 10.0)
      : (profiles[agent]?.limits.daily_spend_cap_usd || 2.0);

    const status: TowerStatus = {
      active_sessions: [], // Sessions tracked separately if needed
      today: {
        total_requests: totalRequests,
        total_spend: totalSpend,
        spend_cap: overallCap,
        spend_remaining: Math.max(0, overallCap - totalSpend)
      },
      agents
    };

    res.json(status);
  } catch (error: any) {
    logger.error('Tower status error:', error);
    res.status(500).json({ error: error.message || 'Failed to get status' });
  }
}) as any);

export default router;
