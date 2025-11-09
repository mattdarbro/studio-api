import { Router, Request, Response } from 'express';
import { queryUsage, calculateStats, getLogCount, getAllLogs } from '../services/usage';
import { executeQuery } from '../db/database';
import { logger } from '../logger';
import fetch from 'node-fetch';

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
    const systemPrompt = `You are an expert SQL analyst. Generate a SQLite query to answer the user's question about API usage logs.

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

After the SQL query, on a new line starting with "EXPLANATION:", provide a brief explanation of what the query does.

Format:
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
      res.status(500).json({
        error: 'Failed to extract SQL from AI response',
        rawResponse: aiMessage,
        suggestion: 'The AI did not return SQL in the expected format. Try rephrasing your question.'
      });
      return;
    }

    // Basic SQL validation - should start with a SQL keyword
    const sqlKeywords = ['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER'];
    const startsWithKeyword = sqlKeywords.some(keyword => sql.toUpperCase().startsWith(keyword));

    if (!startsWithKeyword) {
      logger.error('Extracted text does not appear to be SQL:', sql);
      res.status(500).json({
        error: 'Extracted text does not appear to be valid SQL',
        extractedText: sql,
        suggestion: 'The AI response could not be parsed correctly. Try rephrasing your question.'
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

export default router;
