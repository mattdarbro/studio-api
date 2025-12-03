import { Router, Request, Response } from 'express';
import { queryUsage, calculateStats, getLogCount, getAllLogs } from '../services/usage';
import { executeQuery } from '../db/database';
import { logger } from '../logger';
import fetch from 'node-fetch';
import { getCostStatus } from '../services/costLimits';
import { AuthenticatedRequest } from '../auth';

const router = Router();

/**
 * GET /v1/analytics/usage
 * Query usage logs with optional filters
 *
 * Query Parameters:
 * - appId: Filter by app ID
 * - userId: Filter by user ID
 * - provider: Filter by provider (openai, anthropic, etc.)
 * - endpoint: Filter by endpoint (/v1/chat, /v1/images, etc.)
 * - startDate: Start date (ISO 8601 format)
 * - endDate: End date (ISO 8601 format)
 * - limit: Maximum number of results
 * - groupBy: Group results by field (app, provider, model, endpoint)
 *
 * Requires: x-app-key header for authentication
 */
router.get('/usage', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    // Parse query parameters
    const {
      appId,
      userId,
      provider,
      endpoint,
      startDate,
      endDate,
      limit,
      groupBy,
    } = req.query;

    // Build filters
    const filters: any = {};

    if (appId) filters.appId = appId as string;
    if (userId) filters.userId = userId as string;
    if (provider) filters.provider = provider as string;
    if (endpoint) filters.endpoint = endpoint as string;
    if (limit) filters.limit = parseInt(limit as string, 10);

    // Parse dates
    if (startDate) {
      try {
        filters.startDate = new Date(startDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid startDate format (use ISO 8601)' });
        return;
      }
    }

    if (endDate) {
      try {
        filters.endDate = new Date(endDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid endDate format (use ISO 8601)' });
        return;
      }
    }

    // Query logs
    const logs = queryUsage(filters);

    // Calculate statistics
    const stats = calculateStats(logs);

    logger.debug(`Analytics query: ${logs.length} logs matched`);

    // Return results
    res.json({
      totalLogs: logs.length,
      stats,
      filters,
      // Include raw logs if requested and count is reasonable
      logs: logs.length <= 1000 ? logs : undefined,
      message: logs.length > 1000 ? 'Too many logs to return. Use filters or groupBy to aggregate.' : undefined,
    });
  } catch (error) {
    logger.error('Analytics usage error:', error);
    res.status(500).json({ error: 'Failed to query usage logs' });
  }
});

/**
 * GET /v1/analytics/costs
 * Get cost breakdown by app, provider, or model
 *
 * Query Parameters:
 * - appId: Filter by specific app
 * - startDate: Start date (ISO 8601 format)
 * - endDate: End date (ISO 8601 format)
 *
 * Requires: x-app-key header for authentication
 */
router.get('/costs', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    // Parse query parameters
    const { appId, startDate, endDate } = req.query;

    // Build filters
    const filters: any = {};
    if (appId) filters.appId = appId as string;

    if (startDate) {
      try {
        filters.startDate = new Date(startDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid startDate format' });
        return;
      }
    }

    if (endDate) {
      try {
        filters.endDate = new Date(endDate as string);
      } catch (err) {
        res.status(400).json({ error: 'Invalid endDate format' });
        return;
      }
    }

    // Query logs
    const logs = queryUsage(filters);
    const stats = calculateStats(logs);

    res.json({
      totalCost: stats.totalCost.toFixed(4),
      currency: 'USD',
      breakdown: {
        byProvider: stats.byProvider,
        byModel: stats.byModel,
        byApp: stats.byApp,
        byEndpoint: stats.byEndpoint,
      },
      period: {
        start: filters.startDate || 'all time',
        end: filters.endDate || 'now',
      },
      requestCount: stats.totalRequests,
    });
  } catch (error) {
    logger.error('Analytics costs error:', error);
    res.status(500).json({ error: 'Failed to calculate costs' });
  }
});

/**
 * GET /v1/analytics/apps
 * List all apps with their usage and cost statistics
 *
 * Requires: x-app-key header for authentication
 */
router.get('/apps', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    // Get all logs
    const allLogs = getAllLogs();

    // Group by app
    const appMap = new Map<string, any>();

    for (const log of allLogs) {
      const appKey = log.appId || 'unknown';

      if (!appMap.has(appKey)) {
        appMap.set(appKey, {
          appId: appKey,
          requestCount: 0,
          totalCost: 0,
          firstSeen: log.timestamp,
          lastUsed: log.timestamp,
          successfulRequests: 0,
          failedRequests: 0,
        });
      }

      const app = appMap.get(appKey);
      app.requestCount++;
      app.totalCost += log.estimatedCost / 100; // Convert cents to dollars

      if (log.timestamp < app.firstSeen) app.firstSeen = log.timestamp;
      if (log.timestamp > app.lastUsed) app.lastUsed = log.timestamp;

      if (log.statusCode >= 200 && log.statusCode < 300) {
        app.successfulRequests++;
      } else {
        app.failedRequests++;
      }
    }

    // Convert to array and sort by cost
    const apps = Array.from(appMap.values()).sort((a, b) => b.totalCost - a.totalCost);

    res.json({
      totalApps: apps.length,
      apps: apps.map((app) => ({
        ...app,
        totalCost: app.totalCost.toFixed(4),
        successRate: ((app.successfulRequests / app.requestCount) * 100).toFixed(1) + '%',
      })),
    });
  } catch (error) {
    logger.error('Analytics apps error:', error);
    res.status(500).json({ error: 'Failed to get app statistics' });
  }
});

/**
 * GET /v1/analytics/stats
 * Get overall usage statistics
 *
 * Requires: x-app-key header for authentication
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    const allLogs = getAllLogs();
    const stats = calculateStats(allLogs);

    res.json({
      totalLogs: getLogCount(),
      totalRequests: stats.totalRequests,
      totalCost: stats.totalCost.toFixed(4),
      totalDuration: stats.totalDuration,
      averageDuration: stats.totalRequests > 0 ? Math.round(stats.totalDuration / stats.totalRequests) : 0,
      successRate: stats.totalRequests > 0 ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1) + '%' : '0%',
      breakdown: {
        byProvider: stats.byProvider,
        byModel: stats.byModel,
        byApp: stats.byApp,
        byEndpoint: stats.byEndpoint,
      },
    });
  } catch (error) {
    logger.error('Analytics stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * POST /v1/analytics/chat
 * AI-powered analytics chat interface
 *
 * Ask questions in natural language about your usage data
 * Examples:
 * - "How much did arno-ios spend last week?"
 * - "Which app used the most OpenAI requests yesterday?"
 * - "Show me total costs by provider"
 *
 * Requires: x-app-key header for authentication
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    // Require authentication with app key
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question field is required' });
      return;
    }

    logger.info(`Analytics chat question: "${question}"`);

    // Get database schema info to help AI generate queries
    const schemaDescription = `
Database Schema:
Table: usage_logs
Columns:
- id: INTEGER (primary key)
- timestamp: TEXT (ISO 8601 format, e.g., '2025-01-08T10:30:00Z')
- user_id: TEXT (user identifier)
- app_id: TEXT (app identifier, e.g., 'arno-ios', 'studio-mobile')
- endpoint: TEXT (API endpoint, e.g., '/v1/chat', '/v1/images')
- method: TEXT (HTTP method, e.g., 'POST', 'GET')
- provider: TEXT (LLM provider, e.g., 'openai', 'anthropic', 'replicate')
- model: TEXT (model name, e.g., 'gpt-5', 'claude-sonnet-4-5')
- input_tokens: INTEGER (input token count)
- output_tokens: INTEGER (output token count)
- estimated_cost: INTEGER (cost in USD cents, e.g., 125 means $1.25)
- duration: INTEGER (request duration in milliseconds)
- status_code: INTEGER (HTTP status code, e.g., 200, 500)
- error: TEXT (error message if failed)
- created_at: TEXT (when log was created)

Important:
- Costs are in cents (divide by 100 for USD)
- Use date() function for date comparisons: date(timestamp) = date('2025-01-08')
- Use datetime() for date ranges: datetime(timestamp) >= datetime('2025-01-01')
- For "last week", use: datetime(timestamp) >= datetime('now', '-7 days')
- For "today", use: date(timestamp) = date('now')
- For "this month", use: strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
`;

    // System prompt for AI to generate SQL
    const systemPrompt = `You are an expert SQL analyst for an API usage tracking system. Your job is to generate SQLite queries to answer questions about API usage, costs, and analytics.

${schemaDescription}

Rules:
1. Generate ONLY valid SQLite SQL (no markdown, no explanations in the SQL)
2. Always use proper date/time functions for date comparisons
3. Always divide estimated_cost by 100.0 to show USD (not cents)
4. Use appropriate aggregations (SUM, COUNT, AVG, etc.)
5. Include helpful column aliases
6. Limit results to top 10 by default unless user asks for more
7. For cost queries, format as: ROUND(SUM(estimated_cost) / 100.0, 4) as cost_usd
8. Return results in descending order of importance (cost, count, etc.)

IMPORTANT: If the user's question is NOT related to API usage, costs, analytics, requests, providers, models, tokens, or spending, respond with:
NOT_ANALYTICS_QUESTION: [brief explanation of what kinds of questions you can answer]

Example questions you CAN answer:
- "How much did arno-ios spend last week?"
- "Which app used the most OpenAI requests?"
- "Show me total costs by provider"
- "What are the top 5 most expensive models?"
- "Show me failed requests in the last 24 hours"
- "What's the average response time?"
- "How many tokens were used today?"

Example questions you CANNOT answer (respond with NOT_ANALYTICS_QUESTION):
- "What is the weather?"
- "Hello, how are you?"
- "Write me a poem"
- Random text or gibberish

For valid analytics questions, respond with:
[SQL QUERY]
EXPLANATION: [Brief explanation]`;

    // Use OpenAI API to generate SQL
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      res.status(500).json({
        error: 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable.',
        suggestion: 'The AI chat interface requires an LLM API to convert questions to SQL.'
      });
      return;
    }

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Fast and cheap for SQL generation
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.1, // Low temperature for consistent SQL generation
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      logger.error('OpenAI API error:', errorText);
      res.status(500).json({ error: 'Failed to generate SQL query' });
      return;
    }

    const aiData = await aiResponse.json() as any;
    const aiMessage = aiData.choices[0].message.content;

    logger.debug(`Raw AI response: ${aiMessage}`);

    // Check if the AI determined this is not an analytics question
    if (aiMessage.includes('NOT_ANALYTICS_QUESTION')) {
      const reasonMatch = aiMessage.match(/NOT_ANALYTICS_QUESTION:\s*(.+)/);
      const reason = reasonMatch ? reasonMatch[1].trim() : 'This question is not related to API usage analytics.';

      res.status(400).json({
        error: 'Question not understood',
        reason: reason,
        suggestion: 'Please ask questions about your API usage, costs, or analytics.',
        examples: [
          'How much did arno-ios spend last week?',
          'Which app used the most OpenAI requests?',
          'Show me total costs by provider',
          'What are the top 5 most expensive models?',
          'Show me failed requests in the last 24 hours',
          'What\'s the average response time?',
          'How many tokens were used today?'
        ]
      });
      return;
    }

    // Extract SQL and explanation - handle multiple response formats
    let sql = '';
    let explanation = 'Query generated successfully';

    // Try to extract SQL from markdown code blocks first
    const sqlCodeBlockMatch = aiMessage.match(/```sql\s*\n([\s\S]*?)\n```/);
    const genericCodeBlockMatch = aiMessage.match(/```\s*\n([\s\S]*?)\n```/);

    if (sqlCodeBlockMatch) {
      sql = sqlCodeBlockMatch[1].trim();
      // Extract explanation after the code block
      const afterCodeBlock = aiMessage.split('```')[2] || '';
      const explanationMatch = afterCodeBlock.match(/EXPLANATION:\s*(.+)/);
      if (explanationMatch) {
        explanation = explanationMatch[1].trim();
      }
    } else if (genericCodeBlockMatch) {
      sql = genericCodeBlockMatch[1].trim();
      // Extract explanation after the code block
      const afterCodeBlock = aiMessage.split('```')[2] || '';
      const explanationMatch = afterCodeBlock.match(/EXPLANATION:\s*(.+)/);
      if (explanationMatch) {
        explanation = explanationMatch[1].trim();
      }
    } else {
      // No code blocks, split by EXPLANATION:
      const parts = aiMessage.split('EXPLANATION:');
      sql = parts[0].trim();
      explanation = parts[1]?.trim() || explanation;
    }

    // Remove any remaining markdown or formatting
    sql = sql.replace(/^```sql\s*\n?/, '').replace(/\n?```$/, '').trim();

    // Validate that we extracted SQL
    if (!sql || sql.length === 0) {
      logger.error('Failed to extract SQL from AI response:', aiMessage);
      res.status(400).json({
        error: 'Could not understand your question',
        reason: 'Unable to convert your question into a database query.',
        suggestion: 'Try rephrasing your question to be more specific about API usage, costs, or analytics.',
        examples: [
          'How much did arno-ios spend last week?',
          'Which app used the most OpenAI requests?',
          'Show me total costs by provider',
          'What are the top 5 most expensive models?',
          'Show me failed requests in the last 24 hours'
        ]
      });
      return;
    }

    // SQL validation - ONLY allow SELECT queries (security critical)
    // Block all mutation operations (INSERT, UPDATE, DELETE, DROP, etc.)
    const sqlUpper = sql.toUpperCase().trim();
    const allowedKeywords = ['SELECT', 'WITH']; // WITH is for CTEs (Common Table Expressions)
    const dangerousKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'REPLACE'];

    // Check if query starts with allowed keywords
    const startsWithAllowed = allowedKeywords.some(keyword => sqlUpper.startsWith(keyword));

    // Check if query contains dangerous keywords anywhere (even in subqueries)
    const containsDangerous = dangerousKeywords.some(keyword => sqlUpper.includes(keyword));

    if (!startsWithAllowed || containsDangerous) {
      logger.warn('Blocked potentially dangerous SQL query:', sql);
      res.status(403).json({
        error: 'SQL query validation failed',
        reason: containsDangerous
          ? 'Query contains forbidden mutation keywords (INSERT, UPDATE, DELETE, etc.)'
          : 'Query must start with SELECT or WITH',
        suggestion: 'Only read-only SELECT queries are allowed for security. Try rephrasing your question to query data instead of modifying it.'
      });
      return;
    }

    logger.debug(`Extracted SQL: ${sql}`);

    // Execute the SQL query
    let results: any[] = [];
    let executionError: string | null = null;

    try {
      results = executeQuery(sql);
    } catch (error: any) {
      executionError = error.message;
      logger.error('SQL execution error:', error);
    }

    // Format response
    res.json({
      question,
      sql,
      explanation,
      results,
      resultCount: results.length,
      error: executionError,
      success: !executionError,
    });

  } catch (error: any) {
    logger.error('Analytics chat error:', error);
    res.status(500).json({ error: 'Failed to process chat request', details: error.message });
  }
});

/**
 * GET /v1/analytics/dashboard
 * Get dashboard summary data for visual display
 * Returns overview stats, per-app breakdown, and recent activity
 */
router.get('/dashboard', (req: Request, res: Response) => {
  try {
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    const allLogs = getAllLogs();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Filter logs by time period
    const todayLogs = allLogs.filter(log => log.timestamp >= todayStart);
    const weekLogs = allLogs.filter(log => log.timestamp >= weekStart);
    const monthLogs = allLogs.filter(log => log.timestamp >= monthStart);

    // Calculate totals
    const calcTotals = (logs: any[]) => ({
      requests: logs.length,
      cost: logs.reduce((sum, log) => sum + (log.estimatedCost || 0), 0) / 100,
      tokens: logs.reduce((sum, log) => sum + (log.inputTokens || 0) + (log.outputTokens || 0), 0),
      errors: logs.filter(log => log.statusCode >= 400).length,
    });

    const todayTotals = calcTotals(todayLogs);
    const weekTotals = calcTotals(weekLogs);
    const monthTotals = calcTotals(monthLogs);
    const allTimeTotals = calcTotals(allLogs);

    // Per-app breakdown
    const appMap = new Map<string, any>();
    for (const log of allLogs) {
      const appId = log.appId || 'unknown';
      if (!appMap.has(appId)) {
        appMap.set(appId, {
          appId,
          requests: 0,
          cost: 0,
          errors: 0,
          lastUsed: log.timestamp.toISOString(),
        });
      }
      const app = appMap.get(appId);
      app.requests++;
      app.cost += (log.estimatedCost || 0) / 100;
      if (log.statusCode >= 400) app.errors++;
      if (log.timestamp > app.lastUsed) app.lastUsed = log.timestamp.toISOString();
    }
    const apps = Array.from(appMap.values()).sort((a, b) => b.cost - a.cost);

    // Per-provider breakdown
    const providerMap = new Map<string, any>();
    for (const log of allLogs) {
      const provider = log.provider || 'unknown';
      if (!providerMap.has(provider)) {
        providerMap.set(provider, { provider, requests: 0, cost: 0 });
      }
      const p = providerMap.get(provider);
      p.requests++;
      p.cost += (log.estimatedCost || 0) / 100;
    }
    const providers = Array.from(providerMap.values()).sort((a, b) => b.cost - a.cost);

    // Recent activity (last 10 requests)
    const recentActivity = allLogs
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10)
      .map(log => ({
        timestamp: log.timestamp.toISOString(),
        appId: log.appId || 'unknown',
        endpoint: log.endpoint,
        provider: log.provider,
        model: log.model,
        cost: ((log.estimatedCost || 0) / 100).toFixed(4),
        status: log.statusCode,
        duration: log.duration,
      }));

    res.json({
      summary: {
        today: { ...todayTotals, cost: todayTotals.cost.toFixed(4) },
        week: { ...weekTotals, cost: weekTotals.cost.toFixed(4) },
        month: { ...monthTotals, cost: monthTotals.cost.toFixed(4) },
        allTime: { ...allTimeTotals, cost: allTimeTotals.cost.toFixed(4) },
      },
      apps: apps.map(a => ({ ...a, cost: a.cost.toFixed(4) })),
      providers: providers.map(p => ({ ...p, cost: p.cost.toFixed(4) })),
      recentActivity,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard data', details: error.message });
  }
});

/**
 * GET /v1/analytics/timeseries
 * Get time-series data for charts
 * Query params: period (hourly, daily, weekly), days (number of days to look back)
 */
router.get('/timeseries', (req: Request, res: Response) => {
  try {
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    const period = (req.query.period as string) || 'daily';
    const days = parseInt(req.query.days as string) || 7;
    const appId = req.query.appId as string | undefined;

    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    let allLogs = getAllLogs().filter(log => log.timestamp >= startDate);
    if (appId) {
      allLogs = allLogs.filter(log => log.appId === appId);
    }

    // Group by time bucket
    const buckets = new Map<string, { requests: number; cost: number; errors: number; tokens: number }>();

    for (const log of allLogs) {
      const date = log.timestamp;
      let bucketKey: string;

      if (period === 'hourly') {
        bucketKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:00`;
      } else if (period === 'weekly') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        bucketKey = weekStart.toISOString().split('T')[0];
      } else {
        // daily
        bucketKey = date.toISOString().split('T')[0];
      }

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { requests: 0, cost: 0, errors: 0, tokens: 0 });
      }
      const bucket = buckets.get(bucketKey)!;
      bucket.requests++;
      bucket.cost += (log.estimatedCost || 0) / 100;
      bucket.tokens += (log.inputTokens || 0) + (log.outputTokens || 0);
      if (log.statusCode >= 400) bucket.errors++;
    }

    // Convert to sorted array
    const data = Array.from(buckets.entries())
      .map(([time, stats]) => ({
        time,
        ...stats,
        cost: parseFloat(stats.cost.toFixed(4)),
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    res.json({
      period,
      days,
      appId: appId || 'all',
      data,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Timeseries error:', error);
    res.status(500).json({ error: 'Failed to get timeseries data', details: error.message });
  }
});

/**
 * GET /v1/analytics/health
 * Get health and performance metrics
 */
router.get('/health', (req: Request, res: Response) => {
  try {
    const appKey = req.headers['x-app-key'] as string | undefined;
    const validAppKey = process.env.APP_KEY;

    if (!appKey || !validAppKey || appKey !== validAppKey) {
      res.status(401).json({ error: 'Unauthorized: Valid x-app-key required' });
      return;
    }

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const allLogs = getAllLogs();
    const last24hLogs = allLogs.filter(log => log.timestamp >= last24h);
    const lastHourLogs = allLogs.filter(log => log.timestamp >= lastHour);

    // Calculate performance metrics
    const calcMetrics = (logs: any[]) => {
      if (logs.length === 0) {
        return { avgLatency: 0, p95Latency: 0, errorRate: 0, successRate: 100 };
      }
      const durations = logs.map(log => log.duration || 0).sort((a, b) => a - b);
      const errors = logs.filter(log => log.statusCode >= 400).length;
      const p95Index = Math.floor(durations.length * 0.95);

      return {
        avgLatency: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        p95Latency: durations[p95Index] || 0,
        errorRate: parseFloat(((errors / logs.length) * 100).toFixed(2)),
        successRate: parseFloat((((logs.length - errors) / logs.length) * 100).toFixed(2)),
      };
    };

    const last24hMetrics = calcMetrics(last24hLogs);
    const lastHourMetrics = calcMetrics(lastHourLogs);

    // Per-endpoint health
    const endpointMap = new Map<string, any[]>();
    for (const log of last24hLogs) {
      const endpoint = log.endpoint || 'unknown';
      if (!endpointMap.has(endpoint)) endpointMap.set(endpoint, []);
      endpointMap.get(endpoint)!.push(log);
    }

    const endpoints = Array.from(endpointMap.entries()).map(([endpoint, logs]) => ({
      endpoint,
      requests: logs.length,
      ...calcMetrics(logs),
    }));

    // Per-provider health
    const providerMap = new Map<string, any[]>();
    for (const log of last24hLogs) {
      const provider = log.provider || 'unknown';
      if (!providerMap.has(provider)) providerMap.set(provider, []);
      providerMap.get(provider)!.push(log);
    }

    const providerHealth = Array.from(providerMap.entries()).map(([provider, logs]) => ({
      provider,
      requests: logs.length,
      ...calcMetrics(logs),
    }));

    // Overall health status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (lastHourMetrics.errorRate > 10) status = 'degraded';
    if (lastHourMetrics.errorRate > 25) status = 'unhealthy';

    res.json({
      status,
      lastHour: {
        requests: lastHourLogs.length,
        ...lastHourMetrics,
      },
      last24Hours: {
        requests: last24hLogs.length,
        ...last24hMetrics,
      },
      endpoints,
      providers: providerHealth,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Health error:', error);
    res.status(500).json({ error: 'Failed to get health data', details: error.message });
  }
});

/**
 * GET /v1/analytics/cost-status
 * Get current cost spending status for the authenticated user
 * Shows daily, weekly, and monthly spending with limits
 */
router.get('/cost-status', (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId || userId === 'anonymous') {
      res.status(400).json({ error: 'User ID required for cost tracking' });
      return;
    }

    const costStatus = getCostStatus(userId);

    res.json({
      userId,
      currency: 'USD',
      ...costStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Cost status error:', error);
    res.status(500).json({ error: 'Failed to retrieve cost status', details: error.message });
  }
});

export default router;
