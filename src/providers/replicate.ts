import fetch from 'node-fetch';
import { logger } from '../logger';
import { keepAliveAgent } from '../httpClient';

interface ReplicateImageParams {
  prompt: string;
  model: string; // model name (e.g., black-forest-labs/flux-schnell) or version id
  width?: number;
  height?: number;
  num_outputs?: number;
  key: string;
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[] | null;
  error?: string;
  urls: {
    get: string;
    cancel: string;
  };
}

const modelVersionCache = new Map<string, string>();

async function resolveReplicateVersion(model: string, apiKey: string): Promise<string> {
  const trimmed = model.trim();

  if (!trimmed) {
    throw new Error('Replicate model identifier is required');
  }

  const looksLikeVersion = !trimmed.includes('/') && trimmed.length > 30;
  if (looksLikeVersion) {
    return trimmed;
  }

  // If the catalog already stores version IDs we can skip network calls
  if (modelVersionCache.has(trimmed)) {
    return modelVersionCache.get(trimmed)!;
  }

  const url = `https://api.replicate.com/v1/models/${trimmed}`;
  logger.debug(`Resolving latest version for Replicate model: ${trimmed}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    agent: keepAliveAgent
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error(`Replicate model lookup error: ${response.status} ${error}`);
    throw new Error(`Replicate model lookup error: ${response.status} ${error}`);
  }

  const data = await response.json() as any;
  const versionId = data?.latest_version?.id;

  if (!versionId) {
    throw new Error(`Unable to determine latest version for model ${trimmed}`);
  }

  modelVersionCache.set(trimmed, versionId);
  logger.debug(`Resolved Replicate model ${trimmed} to version ${versionId}`);
  return versionId;
}

export async function replicateCreatePrediction(params: ReplicateImageParams): Promise<ReplicatePrediction> {
  const { prompt, model, width = 1024, height = 1024, num_outputs = 1, key } = params;

  logger.debug(`Replicate creating prediction for model: ${model}`);

  const version = await resolveReplicateVersion(model, key);

  const requestBody = {
    version,
    input: { prompt, width, height, num_outputs }
  };

  logger.debug(`Replicate request body prepared with version: ${version}`);

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait'
    },
    body: JSON.stringify(requestBody),
    agent: keepAliveAgent
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error(`Replicate error: ${error}`);
    throw new Error(`Replicate API error: ${response.status} ${error}`);
  }

  const prediction = await response.json() as ReplicatePrediction;
  logger.debug(`Replicate prediction created: ${prediction.id}, status: ${prediction.status}`);

  return prediction;
}

export async function replicateGetPrediction(predictionId: string, key: string): Promise<ReplicatePrediction> {
  const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: {
      'Authorization': `Bearer ${key}`,
    },
    agent: keepAliveAgent
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Replicate API error: ${response.status} ${error}`);
  }

  return await response.json() as ReplicatePrediction;
}

export async function replicateWaitForPrediction(predictionId: string, key: string, maxWaitMs: number = 60000): Promise<ReplicatePrediction> {
  const startTime = Date.now();
  const pollInterval = 1000; // 1 second

  while (Date.now() - startTime < maxWaitMs) {
    const prediction = await replicateGetPrediction(predictionId, key);

    if (prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled') {
      return prediction;
    }

    logger.debug(`Replicate prediction ${predictionId} status: ${prediction.status}`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Prediction ${predictionId} timed out after ${maxWaitMs}ms`);
}
