import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logger } from '../logger';

/**
 * Apple Sign-In token verification
 *
 * Apple ID tokens are JWTs signed by Apple that contain:
 * - sub: The unique Apple user ID (stable across your app)
 * - email: User's email (if requested and user shared)
 * - aud: Your app's bundle ID
 * - iss: https://appleid.apple.com
 */

interface AppleIDTokenPayload {
  iss: string;           // https://appleid.apple.com
  aud: string;           // Your app's bundle ID
  exp: number;           // Expiration timestamp
  iat: number;           // Issued at timestamp
  sub: string;           // Unique Apple user ID
  email?: string;        // User's email (optional)
  email_verified?: string;
  is_private_email?: string;
  auth_time: number;
  nonce_supported: boolean;
}

// Cache for Apple's public keys (JWKs)
let applePublicKeys: Map<string, crypto.KeyObject> = new Map();
let keysLastFetched: number = 0;
const KEY_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch Apple's public keys for JWT verification
 */
async function fetchApplePublicKeys(): Promise<void> {
  try {
    const response = await fetch('https://appleid.apple.com/auth/keys');
    if (!response.ok) {
      throw new Error(`Failed to fetch Apple keys: ${response.status}`);
    }

    const data = await response.json() as { keys: any[] };

    applePublicKeys.clear();
    for (const key of data.keys) {
      // Convert JWK to PEM format
      const publicKey = crypto.createPublicKey({
        key: key,
        format: 'jwk'
      });
      applePublicKeys.set(key.kid, publicKey);
    }

    keysLastFetched = Date.now();
    logger.info(`Fetched ${applePublicKeys.size} Apple public keys`);
  } catch (error) {
    logger.error('Failed to fetch Apple public keys:', error);
    throw error;
  }
}

/**
 * Get Apple's public key by key ID
 */
async function getApplePublicKey(kid: string): Promise<crypto.KeyObject | null> {
  // Refresh keys if cache is stale
  if (Date.now() - keysLastFetched > KEY_CACHE_DURATION || applePublicKeys.size === 0) {
    await fetchApplePublicKeys();
  }

  return applePublicKeys.get(kid) || null;
}

/**
 * Allowed bundle IDs for your iOS apps
 * Add your app bundle IDs here
 */
const ALLOWED_BUNDLE_IDS = new Set([
  // Add your actual bundle IDs from App Store Connect
  process.env.APPLE_BUNDLE_ID_LOCAL_POET,
  process.env.APPLE_BUNDLE_ID_MERV,
  process.env.APPLE_BUNDLE_ID_DALE,
  process.env.APPLE_BUNDLE_ID_PANNO,
  // Fallback to a generic env var if specific ones aren't set
  process.env.APPLE_BUNDLE_ID,
].filter(Boolean));

// Also accept a comma-separated list of bundle IDs
if (process.env.APPLE_BUNDLE_IDS) {
  process.env.APPLE_BUNDLE_IDS.split(',').forEach(id => ALLOWED_BUNDLE_IDS.add(id.trim()));
}

export interface AppleAuthResult {
  success: boolean;
  userId?: string;       // Apple's unique user ID (sub)
  email?: string;        // User's email if provided
  error?: string;
}

/**
 * Verify an Apple identity token
 *
 * @param identityToken - The identity token from Sign in with Apple
 * @returns AppleAuthResult with user info if valid
 */
export async function verifyAppleToken(identityToken: string): Promise<AppleAuthResult> {
  try {
    // Decode the token header to get the key ID
    const headerPart = identityToken.split('.')[0];
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());

    if (!header.kid) {
      return { success: false, error: 'Invalid token: missing key ID' };
    }

    // Get the public key
    const publicKey = await getApplePublicKey(header.kid);
    if (!publicKey) {
      return { success: false, error: 'Invalid token: unknown key ID' };
    }

    // Verify and decode the token
    const payload = jwt.verify(identityToken, publicKey, {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
    }) as AppleIDTokenPayload;

    // Verify the audience (bundle ID) if we have allowed bundle IDs configured
    if (ALLOWED_BUNDLE_IDS.size > 0 && !ALLOWED_BUNDLE_IDS.has(payload.aud)) {
      logger.warn(`Apple token rejected: bundle ID ${payload.aud} not in allowed list`);
      return { success: false, error: 'Invalid token: unauthorized app' };
    }

    // Token is valid!
    logger.info(`Apple auth successful for user: ${payload.sub.substring(0, 8)}...`);

    return {
      success: true,
      userId: payload.sub,
      email: payload.email,
    };
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return { success: false, error: 'Token expired' };
    }
    if (error.name === 'JsonWebTokenError') {
      return { success: false, error: `Invalid token: ${error.message}` };
    }

    logger.error('Apple token verification failed:', error);
    return { success: false, error: 'Token verification failed' };
  }
}

/**
 * Check if Apple auth is configured
 */
export function isAppleAuthConfigured(): boolean {
  return ALLOWED_BUNDLE_IDS.size > 0;
}
