import { Request } from 'express';

/**
 * Agent profile capabilities
 */
export interface AgentCapabilities {
  allowed: string[];
  denied: string[];
}

/**
 * Agent rate/spend limits
 */
export interface AgentLimits {
  daily_spend_cap_usd: number;
  requests_per_hour: number;
  requests_per_day: number;
  max_tokens_per_request: number;
  max_concurrent_sessions: number;
}

/**
 * Complete agent profile
 */
export interface AgentProfile {
  display_name: string;
  capabilities: AgentCapabilities;
  limits: AgentLimits;
}

/**
 * Agent profiles config file structure
 */
export interface AgentProfiles {
  [agentName: string]: AgentProfile;
}

/**
 * Tower request payload
 */
export interface TowerRequestPayload {
  agent: string;
  capability: string;
  payload: any;
  session_id?: string;
}

/**
 * Tower authenticated request
 */
export interface TowerRequest extends Request {
  tower?: {
    agent: string;
    profile: AgentProfile;
    isAdmin: boolean;
  };
}

/**
 * Audit log entry
 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: string;
  capability: string;
  summary: string;
  cost: number;
  duration_ms: number;
  success: boolean;
  error?: string;
  session_id?: string;
  tokens_used?: number;
}

/**
 * Spend tracking for an agent
 */
export interface AgentSpend {
  today: number;
  requests_today: number;
  requests_this_hour: number;
  last_active: string;
  hourly_reset: number;
  daily_reset: number;
}

/**
 * Tower status response
 */
export interface TowerStatus {
  active_sessions: string[];
  today: {
    total_requests: number;
    total_spend: number;
    spend_cap: number;
    spend_remaining: number;
  };
  agents: {
    [agentName: string]: {
      requests_today: number;
      requests_this_hour: number;
      rate_limit: number;
      spend_today: number;
      spend_cap: number;
      last_active: string;
    };
  };
}
