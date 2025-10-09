import { Router, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { replicateCreatePrediction, replicateGetPrediction, replicateWaitForPrediction } from '../providers/replicate';

const router = Router();

interface ImageRequestBody {
  prompt: string;
  kind?: string;
  width?: number;
  height?: number;
  num_outputs?: number;
  wait?: boolean; // If true, wait for generation to complete
}

// POST /v1/images - Generate image
router.post('/', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      prompt,
      kind = 'image.default',
      width = 1024,
      height = 1024,
      num_outputs = 1,
      wait = true
    } = req.body as ImageRequestBody;

    // Validate request
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
      return;
    }

    // Resolve model configuration
    const modelConfig = resolveModel(kind, req.channel);
    console.log(`[IMAGES] User ${req.user?.id}, kind: ${kind}, provider: ${modelConfig.provider}, model: ${modelConfig.model}`);

    if (modelConfig.provider !== 'replicate') {
      res.status(400).json({ error: `Image generation kind "${kind}" does not use replicate provider` });
      return;
    }

    // Determine API key to use
    const apiKey = req.apiKeys?.replicate || process.env.REPLICATE_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No Replicate API key available' });
      return;
    }

    // Create prediction
    const prediction = await replicateCreatePrediction({
      prompt,
      model: modelConfig.model,
      width,
      height,
      num_outputs,
      key: apiKey
    });

    // If wait=true, poll until complete
    if (wait) {
      console.log(`[IMAGES] Waiting for prediction ${prediction.id} to complete...`);
      const finalPrediction = await replicateWaitForPrediction(prediction.id, apiKey);

      if (finalPrediction.status === 'failed') {
        res.status(500).json({
          error: finalPrediction.error || 'Image generation failed',
          prediction_id: finalPrediction.id
        });
        return;
      }

      res.json({
        id: finalPrediction.id,
        status: finalPrediction.status,
        output: finalPrediction.output,
        urls: finalPrediction.urls
      });
    } else {
      // Return immediately with prediction ID for polling
      res.json({
        id: prediction.id,
        status: prediction.status,
        urls: prediction.urls
      });
    }
  } catch (error: any) {
    console.error('[IMAGES] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// GET /v1/images/:id - Get prediction status
router.get('/:id', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Determine API key to use
    const apiKey = req.apiKeys?.replicate || process.env.REPLICATE_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No Replicate API key available' });
      return;
    }

    const prediction = await replicateGetPrediction(id, apiKey);

    res.json({
      id: prediction.id,
      status: prediction.status,
      output: prediction.output,
      urls: prediction.urls,
      error: prediction.error
    });
  } catch (error: any) {
    console.error('[IMAGES] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
