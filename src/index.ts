import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { rateLimitMiddleware } from './rateLimit';
import { usageTrackerMiddleware } from './middleware/usageTracker';
import { getCatalog } from './models';
import chatRouter from './routes/chat';
import ephemeralRouter from './routes/ephemeral';
import imagesRouter from './routes/images';
import musicRouter from './routes/music';
import validateRouter from './routes/validate';
import analyticsRouter from './routes/analytics';
import { logger } from './logger';

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

// Validation endpoint (no auth required - this IS the auth step)
app.use('/v1/validate', validateRouter);

// Apply authentication and rate limiting to all routes
app.use(authMiddleware as any);
app.use(rateLimitMiddleware as any);

// Apply usage tracking middleware (after auth, tracks all API calls)
app.use(usageTrackerMiddleware as any);

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
  logger.info(`🔐 Validate: http://localhost:${PORT}/v1/validate`);
  logger.info(`📚 Model catalog: http://localhost:${PORT}/v1/models`);
  logger.info(`💬 Chat: http://localhost:${PORT}/v1/chat`);
  logger.info(`⚡ Ephemeral: http://localhost:${PORT}/v1/ephemeral`);
  logger.info(`🎨 Images: http://localhost:${PORT}/v1/images`);
  logger.info(`🎵 Music: http://localhost:${PORT}/v1/music`);
  logger.info(`📊 Analytics: http://localhost:${PORT}/v1/analytics/usage`);
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
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing server...');
  server.close(() => {
    logger.info('Server closed');
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
