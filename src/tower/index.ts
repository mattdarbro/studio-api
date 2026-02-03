import { Router } from 'express';
import { towerAuthMiddleware } from './middleware/auth';
import { permissionMiddleware } from './middleware/permissions';
import { towerRateLimitMiddleware } from './middleware/rateLimiter';
import requestRouter from './routes/request';
import statusRouter from './routes/status';
import auditRouter from './routes/audit';
import { logger } from '../logger';

/**
 * Falcon Tower Router
 *
 * A secure sandbox for AI agents to access capabilities through
 * scoped permissions, rate limits, and audit logging.
 *
 * Routes:
 *   POST /tower/request - Main gateway for agent requests
 *   GET  /tower/status  - Current session and spend information
 *   GET  /tower/audit   - Human-readable activity log
 */
const router = Router();

// Apply tower authentication to all tower routes
router.use(towerAuthMiddleware);

// Apply rate limiting (for POST requests)
router.use(towerRateLimitMiddleware);

// Apply permission checking (for POST requests with capabilities)
router.use(permissionMiddleware);

// Mount routes
router.use('/request', requestRouter);
router.use('/status', statusRouter);
router.use('/audit', auditRouter);

// Health check for tower
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'falcon-tower',
    timestamp: new Date().toISOString()
  });
});

logger.info('Falcon Tower module initialized');

export default router;
