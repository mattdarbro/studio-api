import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { rateLimitMiddleware } from './rateLimit';
import { getCatalog } from './models';
import chatRouter from './routes/chat';
import ephemeralRouter from './routes/ephemeral';
import imagesRouter from './routes/images';
import musicRouter from './routes/music';

// Load environment variables
dotenv.config();

// Validate critical environment variables
console.log('[STARTUP] Checking environment configuration...');
console.log('[STARTUP] All env vars:', Object.keys(process.env).filter(k => k.includes('PORT') || k.includes('HOST')));
console.log('[STARTUP] PORT env var:', process.env.PORT);
console.log('[STARTUP] Railway PORT:', process.env.RAILWAY_PUBLIC_PORT);
if (!process.env.APP_KEY && !process.env.APP_JWT_SECRET) {
  console.warn('[STARTUP] Warning: Neither APP_KEY nor APP_JWT_SECRET is set. Authentication will fail.');
}
if (!process.env.OPENAI_API_KEY) {
  console.warn('[STARTUP] Warning: OPENAI_API_KEY is not set. Users must provide their own API keys.');
}

const app = express();
// Use Railway's provided PORT or fall back to 3000
const PORT = parseInt(process.env.PORT || process.env.RAILWAY_PUBLIC_PORT || '3000', 10);
console.log('[STARTUP] Will bind to port:', PORT);
console.log('[STARTUP] Node version:', process.version);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoints (no auth required)
app.get('/', (req, res) => {
  console.log('[HEALTH] Root endpoint hit');
  res.json({ status: 'ok', service: 'studio-api', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  console.log('[HEALTH] Health endpoint hit');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply authentication and rate limiting to all routes
app.use(authMiddleware as any);
app.use(rateLimitMiddleware as any);

// Routes
app.get('/v1/models', (req, res) => {
  try {
    const catalog = getCatalog();
    res.json(catalog);
  } catch (error: any) {
    console.error('[MODELS] Error:', error);
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
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Lucid API server running on ${HOST}:${PORT}`);
  console.log(`📚 Model catalog endpoint: http://localhost:${PORT}/v1/models`);
  console.log(`💬 Chat endpoint: http://localhost:${PORT}/v1/chat`);
  console.log(`⚡ Ephemeral endpoint: http://localhost:${PORT}/v1/ephemeral`);
  console.log(`🎨 Images endpoint: http://localhost:${PORT}/v1/images`);
  console.log(`🎵 Music endpoint: http://localhost:${PORT}/v1/music`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health\n`);
});

// Keep the server alive
server.on('error', (error: any) => {
  console.error('[SERVER] Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`[SERVER] Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Log when server is closing
server.on('close', () => {
  console.log('[SERVER] Server closed');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, closing server...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received, closing server...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
