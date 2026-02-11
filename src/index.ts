import express, { Request, Response, NextFunction, Router } from 'express';
import fs from 'fs';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { rateLimitMiddleware } from './rateLimit';
import { usageTrackerMiddleware } from './middleware/usageTracker';
import { requestIdMiddleware } from './middleware/requestId';
import { costLimitMiddleware } from './middleware/costLimitMiddleware';
import { getCatalog } from './models';
import chatRouter from './routes/chat';
import ephemeralRouter from './routes/ephemeral';
import imagesRouter from './routes/images';
import musicRouter from './routes/music';
import voiceRouter from './routes/voice';
import validateRouter from './routes/validate';
import authRouter from './routes/auth';
import analyticsRouter from './routes/analytics';
import dispatchRouter from './routes/dispatch';
import { logger } from './logger';
import { getImagePath, imageExists } from './services/imageStorage';
import { flushPending } from './services/usage';
import { closeDatabase } from './db/database';
import { freeTokenEncoding } from './config/pricing';
import { shutdownApns } from './services/apns';

// Load environment variables
dotenv.config();

// Validate critical environment variables
logger.info('Checking environment configuration...');
if (!process.env.APP_KEY && !process.env.APP_JWT_SECRET) {
  logger.warn('Neither APP_KEY nor APP_JWT_SECRET is set. Authentication will fail.');
}

// Check for provider API keys (info level - important for startup)
const providers = ['OPENAI', 'ANTHROPIC', 'GROK', 'REPLICATE', 'ELEVENLABS'];
providers.forEach(provider => {
  const keyName = `${provider}_API_KEY`;
  if (process.env[keyName]) {
    logger.info(`✓ ${provider} API key configured`);
  } else {
    logger.warn(`⚠ ${provider}_API_KEY not set. Users must provide their own API keys.`);
  }
});

const app = express();
// Use Railway's provided PORT or fall back to 3000
const PORT: number = parseInt(process.env.PORT || process.env.RAILWAY_PUBLIC_PORT || '3000', 10);
logger.info(`Will bind to port: ${PORT}`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request ID middleware (for distributed tracing)
app.use(requestIdMiddleware);

// Request logging (debug level - too verbose for production)
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Health check endpoints (no auth required)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'studio-api', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness endpoint - checks if app is ready to serve traffic
app.get('/ready', (req, res) => {
  try {
    // Check database connection
    const { getDatabaseStatus } = require('./db/database');
    const dbStatus = getDatabaseStatus();

    if (!dbStatus.connected) {
      res.status(503).json({
        status: 'not ready',
        reason: 'Database not connected',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // All checks passed
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Validation endpoint (no auth required - this IS the auth step)
app.use('/v1/validate', validateRouter);

// Auth endpoint (no auth required - this IS the auth step)
// Sign in with Apple, refresh, logout
app.use('/v1/auth', authRouter);

// Public hosted images endpoint (no auth required - images need to be publicly accessible)
const publicImagesRouter = Router();
publicImagesRouter.get('/hosted/:userId/:imageId', (req, res) => {
  try {
    const { userId, imageId } = req.params;
    if (!userId || !imageId) {
      res.status(400).json({ error: 'userId and imageId are required' });
      return;
    }
    if (!imageExists(userId, imageId)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    const imagePath = getImagePath(userId, imageId);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const stream = fs.createReadStream(imagePath);
    stream.on('error', (error) => {
      logger.error(`Error streaming image ${imagePath}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream image' });
      }
    });
    stream.pipe(res);
  } catch (error: any) {
    logger.error('Hosted image serve error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
});
app.use('/v1/images', publicImagesRouter);

// Apply authentication and rate limiting to all routes
app.use(authMiddleware);
app.use(rateLimitMiddleware);

// Apply cost limit checking (prevent runaway spending)
app.use(costLimitMiddleware);

// Apply usage tracking middleware (after auth, tracks all API calls)
app.use(usageTrackerMiddleware);

// Routes
app.use('/v1/analytics', analyticsRouter);

app.get('/v1/models', (req, res) => {
  try {
    const catalog = getCatalog();
    res.json(catalog);
  } catch (error: any) {
    logger.error('Models error:', error);
    res.status(500).json({ error: error.message || 'Failed to load model catalog' });
  }
});

app.use('/v1/chat', chatRouter);
app.use('/v1/ephemeral', ephemeralRouter);
app.use('/v1/images', imagesRouter);
app.use('/v1/music', musicRouter);
app.use('/v1/voice', voiceRouter);
app.use('/v1/dispatch', dispatchRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  logger.info(`🚀 Lucid API server running on ${HOST}:${PORT}`);
  logger.info(`🍎 Apple Auth: http://localhost:${PORT}/v1/auth/apple`);
  logger.info(`🔐 Validate: http://localhost:${PORT}/v1/validate`);
  logger.info(`📚 Model catalog: http://localhost:${PORT}/v1/models`);
  logger.info(`💬 Chat: http://localhost:${PORT}/v1/chat`);
  logger.info(`⚡ Ephemeral: http://localhost:${PORT}/v1/ephemeral`);
  logger.info(`🎨 Images: http://localhost:${PORT}/v1/images`);
  logger.info(`🎵 Music: http://localhost:${PORT}/v1/music`);
  logger.info(`🎙️  Voice: http://localhost:${PORT}/v1/voice`);
  logger.info(`📊 Analytics: http://localhost:${PORT}/v1/analytics/usage`);
  logger.info(`🤖 AI Chat: http://localhost:${PORT}/v1/analytics/chat`);
  logger.info(`📨 Dispatch: http://localhost:${PORT}/v1/dispatch`);
  logger.info(`❤️  Health: http://localhost:${PORT}/health`);
});

// Keep the server alive
server.on('error', (error: any) => {
  logger.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Log when server is closing
server.on('close', () => {
  logger.info('Server closed');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server...');
  server.close(() => {
    logger.info('Server closed, flushing pending logs...');
    flushPending();
    closeDatabase();
    freeTokenEncoding();
    shutdownApns();
    logger.info('Cleanup complete');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing server...');
  server.close(() => {
    logger.info('Server closed, flushing pending logs...');
    flushPending();
    closeDatabase();
    freeTokenEncoding();
    shutdownApns();
    logger.info('Cleanup complete');
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', { promise, reason });
  process.exit(1);
});
