import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger';
import { TowerRequest, AgentProfiles, AgentProfile } from '../types';

// Load agent profiles
let agentProfiles: AgentProfiles | null = null;

function loadProfiles(): AgentProfiles {
  if (agentProfiles) return agentProfiles;

  const profilesPath = path.join(__dirname, '../profiles/agents.json');
  const data = fs.readFileSync(profilesPath, 'utf8');
  agentProfiles = JSON.parse(data) as AgentProfiles;
  return agentProfiles;
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;

  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    crypto.timingSafeEqual(bufferB, bufferB);
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Tower authentication middleware
 *
 * Validates x-tower-key header against configured agent keys.
 * Sets req.tower with agent info and profile.
 */
export const towerAuthMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const towerReq = req as TowerRequest;

  try {
    const towerKey = req.headers['x-tower-key'] as string | undefined;

    if (!towerKey) {
      res.status(401).json({ error: 'Tower authentication required: provide x-tower-key header' });
      return;
    }

    const profiles = loadProfiles();

    // Check for admin (Matt) key first
    const adminKey = process.env.TOWER_ADMIN_KEY;
    if (adminKey && timingSafeCompare(towerKey, adminKey)) {
      const profile = profiles['matt'];
      if (!profile) {
        res.status(500).json({ error: 'Admin profile not configured' });
        return;
      }

      towerReq.tower = {
        agent: 'matt',
        profile,
        isAdmin: true
      };
      logger.debug('Tower auth: admin (matt)');
      next();
      return;
    }

    // Check for Lucid key
    const lucidKey = process.env.TOWER_LUCID_KEY;
    if (lucidKey && timingSafeCompare(towerKey, lucidKey)) {
      const profile = profiles['lucid'];
      if (!profile) {
        res.status(500).json({ error: 'Lucid profile not configured' });
        return;
      }

      towerReq.tower = {
        agent: 'lucid',
        profile,
        isAdmin: false
      };
      logger.debug('Tower auth: lucid');
      next();
      return;
    }

    // No valid key found
    res.status(401).json({ error: 'Invalid tower key' });
  } catch (error) {
    logger.error('Tower auth error:', error);
    res.status(500).json({ error: 'Tower authentication error' });
  }
};

/**
 * Reload profiles (useful for config updates without restart)
 */
export function reloadProfiles(): void {
  agentProfiles = null;
  loadProfiles();
}

/**
 * Get an agent's profile
 */
export function getAgentProfile(agent: string): AgentProfile | undefined {
  const profiles = loadProfiles();
  return profiles[agent];
}

/**
 * Get all profiles
 */
export function getAllProfiles(): AgentProfiles {
  return loadProfiles();
}
