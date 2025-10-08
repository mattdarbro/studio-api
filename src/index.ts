import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware } from './auth';
import { rateLimitMiddleware } from './rateLimit';
import { getCatalog } from './models';
import chatRouter from './routes/chat';
import ephemeralRouter from './routes/ephemeral';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply authentication and rate limiting to all routes
app.use(authMiddleware);
app.use(rateLimitMiddleware);

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
app.listen(PORT, () => {
  console.log(`\n🚀 Studio API server running on port ${PORT}`);
  console.log(`📚 Model catalog endpoint: http://localhost:${PORT}/v1/models`);
  console.log(`💬 Chat endpoint: http://localhost:${PORT}/v1/chat`);
  console.log(`⚡ Ephemeral endpoint: http://localhost:${PORT}/v1/ephemeral`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health\n`);
});
