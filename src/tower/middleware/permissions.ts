import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../../logger';
import { TowerRequest, TowerRequestPayload } from '../types';

/**
 * Check if an agent has permission to use a capability
 */
export function hasCapability(
  allowed: string[],
  denied: string[],
  capability: string
): boolean {
  // Check denied list first (explicit denials take precedence)
  if (denied.includes(capability)) {
    return false;
  }

  // Wildcard allows everything not explicitly denied
  if (allowed.includes('*')) {
    return true;
  }

  // Check if capability is in allowed list
  return allowed.includes(capability);
}

/**
 * Middleware to check capability permissions
 * Must be used after towerAuthMiddleware
 */
export const permissionMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const towerReq = req as TowerRequest;

  try {
    // Skip permission check for non-request endpoints (status, audit)
    if (req.method === 'GET') {
      next();
      return;
    }

    // Ensure tower auth has been applied
    if (!towerReq.tower) {
      res.status(500).json({ error: 'Tower auth not initialized' });
      return;
    }

    const body = req.body as TowerRequestPayload;
    const capability = body?.capability;

    // If no capability specified, let the route handler deal with it
    if (!capability) {
      next();
      return;
    }

    const { profile, agent } = towerReq.tower;
    const { allowed, denied } = profile.capabilities;

    if (!hasCapability(allowed, denied, capability)) {
      logger.warn(`Tower: ${agent} denied access to capability: ${capability}`);
      res.status(403).json({
        error: 'Capability denied',
        capability,
        agent,
        message: `Agent '${agent}' does not have permission to use '${capability}'`
      });
      return;
    }

    logger.debug(`Tower: ${agent} granted access to capability: ${capability}`);
    next();
  } catch (error) {
    logger.error('Permission check error:', error);
    res.status(500).json({ error: 'Permission check failed' });
  }
};
