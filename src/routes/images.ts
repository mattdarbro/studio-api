import { Router, Request, Response, RequestHandler } from 'express';
import { AuthenticatedRequest } from '../auth';
import { resolveModel } from '../models';
import { replicateCreatePrediction, replicateGetPrediction, replicateWaitForPrediction } from '../providers/replicate';
import { logger } from '../logger';
import { downloadImage, saveImage, generateImageId, getImagePath, imageExists } from '../services/imageStorage';
import { insertHostedImage } from '../db/database';
import fs from 'fs';

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

    const replicateUrl = Array.isArray(finalPrediction.output) ? finalPrediction.output[0] : finalPrediction.output;

    if (!replicateUrl) {
      res.status(500).json({ error: 'Image generation completed without output URL', prediction_id: finalPrediction.id });
      return;
    }

    // Download and host image for stable URLs (solves CloudKit sync issues)
    try {
      const userId = req.user?.id || 'anonymous';
      const imageId = generateImageId(finalPrediction.id);

      // Download image from Replicate
      const imageBuffer = await downloadImage(replicateUrl);

      // Save to persistent storage
      const hostedPath = await saveImage(imageBuffer, userId, imageId);

      // Save metadata to database
      const fullImagePath = getImagePath(userId, imageId.endsWith('.png') ? imageId : `${imageId}.png`);
      insertHostedImage({
        id: imageId,
        userId,
        replicatePredictionId: finalPrediction.id,
        filePath: fullImagePath,
        fileSize: imageBuffer.length,
        contentType: 'image/png'
      });

      // Construct full hosted URL
      const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
      const hostedUrl = `${baseUrl}${hostedPath}`;

      logger.info(`Hosted image for user ${userId}: ${hostedUrl}`);

      res.json({
        url: hostedUrl,
        replicate_url: replicateUrl,
        size_bytes: imageBuffer.length,
        hosted_at: new Date().toISOString(),
        prediction_id: finalPrediction.id
      });
    } catch (hostingError: any) {
      // If hosting fails, fall back to Replicate URL
      logger.error('Image hosting failed, falling back to Replicate URL:', hostingError);
      res.json({
        url: replicateUrl,
        hosting_error: hostingError.message,
        prediction_id: finalPrediction.id
      });
    }
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

// GET /v1/images/hosted/:userId/:imageId - Serve hosted images
router.get('/hosted/:userId/:imageId', (req: Request, res: Response): void => {
  try {
    const { userId, imageId } = req.params;

    // Validate parameters
    if (!userId || !imageId) {
      res.status(400).json({ error: 'userId and imageId are required' });
      return;
    }

    // Check if image exists
    if (!imageExists(userId, imageId)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    // Get image path
    const imagePath = getImagePath(userId, imageId);

    // Set headers for image serving
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache for 1 year
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow cross-origin access

    // Stream the file
    const stream = fs.createReadStream(imagePath);

    stream.on('error', (error) => {
      logger.error(`Error streaming image ${imagePath}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream image' });
      }
    });

    stream.pipe(res);
  } catch (error: any) {
    logger.error('Hosted image serve error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
});

export default router;
