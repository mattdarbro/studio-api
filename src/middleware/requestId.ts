import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';

/**
 * Extended request with request ID
 */
export interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Generate a unique request ID for distributed tracing
 * Adds `x-request-id` header to both request and response
 */
export const requestIdMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const extReq = req as RequestWithId;

  // Check if client provided a request ID (for distributed tracing)
  let requestId = req.headers['x-request-id'] as string | undefined;

  // If no ID provided, generate one
  if (!requestId) {
    requestId = crypto.randomBytes(16).toString('hex');
  }

  // Attach to request for logging
  extReq.requestId = requestId;

  // Add to response headers for client tracing
  res.setHeader('x-request-id', requestId);

  next();
};
