import { Router, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { replicateCreatePrediction, replicateGetPrediction, replicateWaitForPrediction } from '../providers/replicate';
import { logger } from '../logger';

const router = Router();

interface ImageRequestBody {
  prompt: string;
  kind?: string;
  width?: number;
  height?: number;
  num_outputs?: number;
  wait?: boolean; // If true, wait for generation to complete
}

const STYLE_PROMPTS: Record<string, string> = {
  photorealistic: 'Ultra detailed photorealistic rendering',
  artistic: 'Artistic illustration with expressive brushwork',
  abstract: 'Abstract composition emphasizing shapes and colors',
  minimalist: 'Minimalist composition with clean lines and negative space',
  humorous: 'Playful, humorous, light-hearted interpretation'
};

type ImageStyle = keyof typeof STYLE_PROMPTS;

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
    logger.debug(`User ${req.user?.id}, kind: ${kind}, provider: ${modelConfig.provider}, model: ${modelConfig.model}`);

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
      logger.debug(`Waiting for prediction ${prediction.id} to complete...`);
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
    logger.error('Images error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// POST /v1/images/generate - Custom generation workflow for mobile app
router.post('/generate', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { prompt, width = 1024, height = 1024, style } = req.body as {
      prompt?: string;
      width?: number;
      height?: number;
      style?: string;
    };

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
      return;
    }

    if (typeof width !== 'number' || width <= 0 || typeof height !== 'number' || height <= 0) {
      res.status(400).json({ error: 'width and height must be positive numbers' });
      return;
    }

    let finalPrompt = prompt.trim();
    let selectedStyle: ImageStyle | undefined;

    if (style) {
      const normalized = style.toLowerCase() as ImageStyle;
      if (!STYLE_PROMPTS[normalized]) {
        res.status(400).json({
          error: `style must be one of: ${Object.keys(STYLE_PROMPTS).join(', ')}`
        });
        return;
      }
      selectedStyle = normalized;
      // Append gentle style hint to prompt while keeping original text untouched
      finalPrompt = `${finalPrompt}. Style direction: ${STYLE_PROMPTS[normalized]}.`;
    }

    const modelConfig = resolveModel('image.default', req.channel);
    if (modelConfig.provider !== 'replicate') {
      res.status(500).json({ error: 'Configured image provider is not Replicate' });
      return;
    }

    const apiKey = req.apiKeys?.replicate || process.env.REPLICATE_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No Replicate API key available' });
      return;
    }

    logger.debug(
      `Mobile image generate request: user ${req.user?.id}, style: ${selectedStyle || 'none'}, channel: ${req.channel}`
    );

    const prediction = await replicateCreatePrediction({
      prompt: finalPrompt,
      model: modelConfig.model,
      width,
      height,
      num_outputs: 1,
      key: apiKey
    });

    const finalPrediction =
      prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled'
        ? prediction
        : await replicateWaitForPrediction(prediction.id, apiKey);

    if (finalPrediction.status !== 'succeeded' || !finalPrediction.output || finalPrediction.output.length === 0) {
      const message = finalPrediction.error || 'Image generation failed';
      logger.error(`Image generation failed. Prediction ${finalPrediction.id}: ${message}`);
      res.status(500).json({ error: message, prediction_id: finalPrediction.id });
      return;
    }

    const url = Array.isArray(finalPrediction.output) ? finalPrediction.output[0] : finalPrediction.output;

    if (!url) {
      res.status(500).json({ error: 'Image generation completed without output URL', prediction_id: finalPrediction.id });
      return;
    }

    res.json({ url });
  } catch (error: any) {
    logger.error('Images generate error:', error);
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
    logger.error('Images error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
