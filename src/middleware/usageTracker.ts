import { Request, Response, NextFunction } from 'express';
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
export const usageTrackerMiddleware = (
  req: AuthenticatedRequest,
  res: TrackedResponse,
  next: NextFunction
): void => {
  // Skip tracking for health checks and validation endpoints
  if (req.path === '/health' || req.path.startsWith('/v1/validate')) {
    next();
    return;
  }

  // Record start time
  const startTime = Date.now();
  res.__usageStartTime = startTime;

  // Save original res.json and res.send methods
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Track if we've already logged (prevent double-logging)
  res.__usageTracked = false;

  /**
   * Helper function to log usage when response is sent
   */
  const trackUsage = (body: any, statusCode: number) => {
    if (res.__usageTracked) return; // Already tracked
    res.__usageTracked = true;

    const duration = Date.now() - startTime;
    const userId = req.user?.id || 'anonymous';
    const appId = req.appId || null;
    const endpoint = req.path;
    const method = req.method;

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
        const messages = req.body?.messages || [];
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
          if (model && model.startsWith('gpt')) provider = 'openai';
          else if (model && model.startsWith('claude')) provider = 'anthropic';
          else if (model && model.startsWith('grok')) provider = 'grok';
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

        const numImages = req.body?.num_outputs || 1;

        if (model) {
          estimatedCost = Math.round(calculateImageCost('replicate', model, numImages) * 100);
        }
      } else if (endpoint.startsWith('/v1/music')) {
        // Music generation
        provider = 'elevenlabs';
        model = 'eleven_music';

        const duration = req.body?.duration || 30;
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

  // Override res.json
  res.json = function (body: any): Response {
    trackUsage(body, res.statusCode);
    return originalJson(body);
  };

  // Override res.send
  res.send = function (body: any): Response {
    trackUsage(body, res.statusCode);
    return originalSend(body);
  };

  // Also handle response finish event as fallback
  res.on('finish', () => {
    trackUsage(null, res.statusCode);
  });

  next();
};
