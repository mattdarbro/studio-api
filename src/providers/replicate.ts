import fetch from 'node-fetch';
import { logger } from '../logger';

interface ReplicateImageParams {
  prompt: string;
  model: string;
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

export async function replicateCreatePrediction(params: ReplicateImageParams): Promise<ReplicatePrediction> {
  const { prompt, model, width = 1024, height = 1024, num_outputs = 1, key } = params;

  logger.debug(`Replicate creating prediction for model: ${model}`);

  // Determine if model is a version hash or model name
  const isVersionHash = model.length > 40 && !model.includes('/');
  const requestBody = isVersionHash 
    ? {
        version: model,
        input: { prompt, width, height, num_outputs }
      }
    : {
        model: model,
        input: { prompt, width, height, num_outputs }
      };

  logger.debug(`Replicate request body: ${JSON.stringify(requestBody)}`);

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait'
    },
    body: JSON.stringify(requestBody)
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
    }
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
