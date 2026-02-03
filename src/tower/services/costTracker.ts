import { logger } from '../../logger';
import { addAgentSpend, getAgentTrackingData, isSpendCapExceeded } from '../middleware/rateLimiter';

/**
 * Model pricing for cost estimation (per 1K tokens)
 * Based on common Anthropic models - update as needed
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude Opus 4.5
  'claude-opus-4-5-20251101': { input: 0.005, output: 0.025 },
  // Claude Sonnet 4.5
  'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  // Claude Haiku 4.5
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.004 },
  // Fallback for unknown models
  'default': { input: 0.003, output: 0.015 }
};

/**
 * Estimate cost for a Claude API call
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Record spend for an agent and check caps
 */
export function recordSpend(
  agent: string,
  cost: number,
  spendCap: number
): {
  recorded: boolean;
  total_today: number;
  cap: number;
  remaining: number;
  cap_exceeded: boolean;
} {
  // Add to tracking
  addAgentSpend(agent, cost);

  const tracking = getAgentTrackingData(agent);
  const remaining = Math.max(0, spendCap - tracking.today);
  const capExceeded = isSpendCapExceeded(agent, spendCap);

  if (capExceeded) {
    logger.warn(`Tower: ${agent} has exceeded daily spend cap ($${spendCap})`);
  }

  return {
    recorded: true,
    total_today: tracking.today,
    cap: spendCap,
    remaining,
    cap_exceeded: capExceeded
  };
}

/**
 * Check if agent can afford a request based on estimated cost
 */
export function canAffordRequest(
  agent: string,
  estimatedCost: number,
  spendCap: number
): { allowed: boolean; reason?: string; current_spend: number; cap: number } {
  const tracking = getAgentTrackingData(agent);

  if (tracking.today >= spendCap) {
    return {
      allowed: false,
      reason: 'Daily spend cap reached',
      current_spend: tracking.today,
      cap: spendCap
    };
  }

  // Allow request if it would put us slightly over (within 10% of cap)
  // This prevents blocking requests at the edge
  const projectedSpend = tracking.today + estimatedCost;
  const softCap = spendCap * 1.1;

  if (projectedSpend > softCap && tracking.today > 0) {
    return {
      allowed: false,
      reason: 'Projected spend would exceed cap',
      current_spend: tracking.today,
      cap: spendCap
    };
  }

  return {
    allowed: true,
    current_spend: tracking.today,
    cap: spendCap
  };
}

/**
 * Get spend summary for an agent
 */
export function getSpendSummary(
  agent: string,
  spendCap: number
): {
  today: number;
  cap: number;
  remaining: number;
  percentage_used: number;
} {
  const tracking = getAgentTrackingData(agent);
  const remaining = Math.max(0, spendCap - tracking.today);
  const percentageUsed = spendCap > 0 ? (tracking.today / spendCap) * 100 : 0;

  return {
    today: tracking.today,
    cap: spendCap,
    remaining,
    percentage_used: Math.min(100, percentageUsed)
  };
}
