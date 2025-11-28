import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { logUsage } from '../services/usage';
import { calculateTokenCost, calculateImageCost, calculateMusicCost, estimateTokens } from '../config/pricing';
import { logger } from '../logger';

/**
 * Enhanced response object to track original methods
 */
interface TrackedResponse extends Response {
  __usageStartTime?: number;
  __usageTracked?: boolean;
}

/**
 * Middleware to track API usage, costs, and performance
 */
export const usageTrackerMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authReq = req as AuthenticatedRequest;
  const trackedRes = res as TrackedResponse;

  // Skip tracking for health checks and validation endpoints
  if (authReq.path === '/health' || authReq.path.startsWith('/v1/validate')) {
    next();
    return;
  }

  // Record start time
  const startTime = Date.now();
  trackedRes.__usageStartTime = startTime;

  // Save original res.json and res.send methods
  const originalJson = trackedRes.json.bind(trackedRes);
  const originalSend = trackedRes.send.bind(trackedRes);

  // Track if we've already logged (prevent double-logging)
  trackedRes.__usageTracked = false;

  /**
   * Helper function to log usage when response is sent
   */
  const trackUsage = (body: any, statusCode: number) => {
    if (trackedRes.__usageTracked) return; // Already tracked
    trackedRes.__usageTracked = true;

    const duration = Date.now() - startTime;
    const userId = authReq.user?.id || 'anonymous';
    const appId = authReq.appId || null;
    const endpoint = authReq.path;
    const method = authReq.method;

    // Extract provider and model info from request
    let provider: string | null = null;
    let model: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0; // in cents
    let error: string | null = null;

    // Try to extract error message
    if (statusCode >= 400 && body && typeof body === 'object' && body.error) {
      error = body.error;
    }

    // Estimate tokens and costs based on endpoint
    try {
      if (endpoint.startsWith('/v1/chat')) {
        // Chat endpoint - estimate tokens
        const messages = authReq.body?.messages || [];
        const messagesText = messages.map((m: any) => m.content || '').join(' ');
        inputTokens = estimateTokens(messagesText);

        // Try to extract output tokens from response
        if (body && typeof body === 'object') {
          if (body.choices && body.choices[0]?.message?.content) {
            outputTokens = estimateTokens(body.choices[0].message.content);
          }

          // Extract actual usage if available (OpenAI format)
          if (body.usage) {
            inputTokens = body.usage.prompt_tokens || inputTokens;
            outputTokens = body.usage.completion_tokens || outputTokens;
          }
        }

        // Determine provider and model from response or request
        if (body && body.model) {
          model = body.model;
          // Infer provider from model name
          if (model && (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4'))) {
            provider = 'openai';
          } else if (model && model.startsWith('claude')) {
            provider = 'anthropic';
          } else if (model && model.startsWith('grok')) {
            provider = 'grok';
          }
        }

        // Calculate cost
        if (provider && model) {
          estimatedCost = Math.round(
            calculateTokenCost(provider as any, model, inputTokens, outputTokens) * 100
          );
        }
      } else if (endpoint.startsWith('/v1/images')) {
        // Image generation
        provider = 'replicate';

        // Try to extract model from response or default
        if (body && body.version) {
          model = 'black-forest-labs/flux-schnell'; // Default
        }

        const numImages = authReq.body?.num_outputs || 1;

        if (model) {
          estimatedCost = Math.round(calculateImageCost('replicate', model, numImages) * 100);
        }
      } else if (endpoint.startsWith('/v1/music')) {
        // Music generation
        provider = 'elevenlabs';
        model = 'eleven_music';

        const duration = authReq.body?.duration || 30;
        estimatedCost = Math.round(calculateMusicCost('elevenlabs', model, duration) * 100);
      } else if (endpoint.startsWith('/v1/ephemeral')) {
        // Realtime API
        provider = 'openai';
        model = 'gpt-4o-realtime-preview';
        // Cost will be tracked during actual usage, not session creation
        estimatedCost = 0;
      }
    } catch (err) {
      logger.error('Error calculating usage cost:', err);
    }

    // Log the usage
    logUsage({
      timestamp: new Date(startTime),
      userId,
      appId,
      endpoint,
      method,
      provider,
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      duration,
      statusCode,
      error,
    });
  };

  // Override trackedRes.json
  trackedRes.json = function (body: any): Response {
    trackUsage(body, trackedRes.statusCode);
    return originalJson(body);
  };

  // Override trackedRes.send
  trackedRes.send = function (body: any): Response {
    trackUsage(body, trackedRes.statusCode);
    return originalSend(body);
  };

  // Also handle response finish event as fallback
  trackedRes.on('finish', () => {
    trackUsage(null, trackedRes.statusCode);
  });

  next();
};
