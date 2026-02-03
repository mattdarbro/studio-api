import { Router, Response } from 'express';
import { logger } from '../../logger';
import { anthropicChat } from '../../providers/anthropic';
import { TowerRequest, TowerRequestPayload } from '../types';
import { estimateCost, recordSpend, canAffordRequest } from '../services/costTracker';
import { logAuditEntry } from '../services/auditLog';

const router = Router();

/**
 * POST /tower/request
 *
 * The main gateway for all tower requests.
 * Routes capabilities to appropriate downstream services.
 */
router.post('/', (async (req: TowerRequest, res: Response) => {
  const startTime = Date.now();
  let capability = 'unknown';
  let tokensUsed = 0;
  let cost = 0;

  try {
    if (!req.tower) {
      res.status(500).json({ error: 'Tower auth not initialized' });
      return;
    }

    const { agent, profile } = req.tower;
    const body = req.body as TowerRequestPayload;

    // Validate request
    if (!body.capability) {
      res.status(400).json({ error: 'capability is required' });
      return;
    }

    capability = body.capability;

    // Check spend cap before processing
    const affordCheck = canAffordRequest(
      agent,
      0.10, // Estimated max cost for a request
      profile.limits.daily_spend_cap_usd
    );

    if (!affordCheck.allowed) {
      res.status(429).json({
        error: 'Daily spend cap exceeded',
        current_spend: affordCheck.current_spend,
        cap: affordCheck.cap,
        message: affordCheck.reason
      });
      return;
    }

    // Route to appropriate capability handler
    let result: any;

    switch (capability) {
      case 'claude_api': {
        result = await handleClaudeApi(agent, profile, body.payload);
        tokensUsed = result.usage?.total_tokens || 0;
        cost = estimateCost(
          body.payload?.model || 'claude-sonnet-4-20250514',
          result.usage?.prompt_tokens || 0,
          result.usage?.completion_tokens || 0
        );
        break;
      }

      case 'claude_code': {
        // Placeholder for Claude Code integration
        // This would trigger a Claude Code session
        result = {
          status: 'not_implemented',
          message: 'Claude Code integration coming soon'
        };
        break;
      }

      case 'image_gen': {
        // Placeholder for image generation
        result = {
          status: 'not_implemented',
          message: 'Image generation integration coming soon'
        };
        break;
      }

      case 'web_search':
      case 'web_fetch': {
        // Placeholder for web capabilities
        result = {
          status: 'not_implemented',
          message: `${capability} integration coming soon`
        };
        break;
      }

      case 'file_read':
      case 'file_write': {
        // Placeholder for file operations
        result = {
          status: 'not_implemented',
          message: `${capability} requires workspace setup`
        };
        break;
      }

      default:
        res.status(400).json({
          error: 'Unknown capability',
          capability,
          available_capabilities: [
            'claude_api',
            'claude_code',
            'image_gen',
            'web_search',
            'web_fetch',
            'file_read',
            'file_write'
          ]
        });
        return;
    }

    // Record spend
    const spendResult = recordSpend(agent, cost, profile.limits.daily_spend_cap_usd);

    // Log successful request
    const duration = Date.now() - startTime;
    logAuditEntry({
      agent,
      capability,
      summary: generateSummary(capability, body.payload, result),
      cost,
      duration_ms: duration,
      success: true,
      session_id: body.session_id,
      tokens_used: tokensUsed
    });

    // Return response
    res.json({
      status: 'success',
      result,
      meta: {
        capability_used: capability,
        tokens_used: tokensUsed,
        cost_estimate: cost,
        session_spend_total: spendResult.total_today,
        daily_spend_total: spendResult.total_today,
        daily_spend_remaining: spendResult.remaining
      }
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;

    // Log failed request
    if (req.tower) {
      logAuditEntry({
        agent: req.tower.agent,
        capability,
        summary: `Error: ${error.message}`,
        cost: 0,
        duration_ms: duration,
        success: false,
        error: error.message,
        session_id: (req.body as TowerRequestPayload)?.session_id
      });
    }

    logger.error('Tower request error:', error);
    res.status(500).json({
      status: 'error',
      error: error.message || 'Request failed'
    });
  }
}) as any);

/**
 * Handle Claude API requests
 */
async function handleClaudeApi(
  agent: string,
  profile: any,
  payload: any
): Promise<any> {
  if (!payload?.messages) {
    throw new Error('messages are required for claude_api capability');
  }

  const model = payload.model || 'claude-sonnet-4-20250514';
  const maxTokens = Math.min(
    payload.max_tokens || 4096,
    profile.limits.max_tokens_per_request
  );

  // Get API key from environment
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  logger.debug(`Tower: ${agent} calling Claude API with model ${model}`);

  const result = await anthropicChat({
    model,
    messages: payload.messages,
    key: apiKey,
    max_tokens: maxTokens
  });

  return result;
}

/**
 * Generate a human-readable summary of the request
 */
function generateSummary(capability: string, payload: any, result: any): string {
  switch (capability) {
    case 'claude_api': {
      const messageCount = payload?.messages?.length || 0;
      const outputLength = result?.choices?.[0]?.message?.content?.length || 0;
      return `Claude API: ${messageCount} messages, ${outputLength} chars response`;
    }
    case 'claude_code':
      return `Claude Code: ${payload?.task?.substring(0, 50) || 'task'}...`;
    case 'image_gen':
      return `Image generation: ${payload?.prompt?.substring(0, 50) || 'prompt'}...`;
    case 'web_search':
      return `Web search: ${payload?.query?.substring(0, 50) || 'query'}...`;
    case 'web_fetch':
      return `Web fetch: ${payload?.url?.substring(0, 50) || 'url'}...`;
    case 'file_read':
      return `File read: ${payload?.path || 'path'}`;
    case 'file_write':
      return `File write: ${payload?.path || 'path'}`;
    default:
      return `${capability} request`;
  }
}

export default router;
