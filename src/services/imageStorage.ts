import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger';
import { fetchWithTimeout, TIMEOUTS } from '../utils/fetchWithTimeout';

/**
 * Image storage configuration
 */
const IMAGE_STORAGE_PATH = process.env.IMAGE_STORAGE_PATH || '/data/images';
const IMAGE_MAX_AGE_DAYS = parseInt(process.env.IMAGE_MAX_AGE_DAYS || '90', 10);
const IMAGE_PER_USER_LIMIT = parseInt(process.env.IMAGE_PER_USER_LIMIT || '50', 10);
const IMAGE_HOSTING_ENABLED = process.env.IMAGE_HOSTING_ENABLED !== 'false'; // Default true

/**
 * Download an image from a URL
 */
export async function downloadImage(url: string): Promise<Buffer> {
  try {
    logger.debug(`Downloading image from: ${url}`);
    const response = await fetchWithTimeout(url, { timeout: TIMEOUTS.IMAGE });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}, expected image/*`);
    }

    const buffer = await response.buffer();
    logger.debug(`Downloaded image: ${buffer.length} bytes`);
    return buffer;
  } catch (error: any) {
    logger.error('Image download error:', error);
    throw new Error(`Failed to download image: ${error.message}`);
  }
}

/**
 * Save an image to persistent storage
 * Returns the hosted URL path
 */
export async function saveImage(
  buffer: Buffer,
  userId: string,
  imageId: string
): Promise<string> {
  if (!IMAGE_HOSTING_ENABLED) {
    throw new Error('Image hosting is disabled');
  }

  try {
    // Create user directory if it doesn't exist
    const userDir = path.join(IMAGE_STORAGE_PATH, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
      logger.debug(`Created user directory: ${userDir}`);
    }

    // Save image file
    const filename = `${imageId}.png`;
    const filePath = path.join(userDir, filename);
    fs.writeFileSync(filePath, buffer);

    logger.info(`Saved image: ${filePath} (${buffer.length} bytes)`);

    // Return the URL path (without domain)
    return `/v1/images/hosted/${userId}/${filename}`;
  } catch (error: any) {
    logger.error('Image save error:', error);
    throw new Error(`Failed to save image: ${error.message}`);
  }
}

/**
 * Get the filesystem path for an image
 */
export function getImagePath(userId: string, imageId: string): string {
  const filename = imageId.endsWith('.png') ? imageId : `${imageId}.png`;
  return path.join(IMAGE_STORAGE_PATH, userId, filename);
}

/**
 * Check if an image exists
 */
export function imageExists(userId: string, imageId: string): boolean {
  const imagePath = getImagePath(userId, imageId);
  return fs.existsSync(imagePath);
}

/**
 * Delete an image from storage
 */
export async function deleteImage(userId: string, imageId: string): Promise<void> {
  try {
    const imagePath = getImagePath(userId, imageId);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      logger.info(`Deleted image: ${imagePath}`);
    }
  } catch (error: any) {
    logger.error('Image delete error:', error);
    throw new Error(`Failed to delete image: ${error.message}`);
  }
}

/**
 * Get all images for a user
 */
export function getUserImages(userId: string): Array<{ filename: string; size: number; createdAt: Date }> {
  const userDir = path.join(IMAGE_STORAGE_PATH, userId);

  if (!fs.existsSync(userDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(userDir);
    return files
      .filter(f => f.endsWith('.png'))
      .map(filename => {
        const filePath = path.join(userDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          size: stats.size,
          createdAt: stats.birthtime
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Newest first
  } catch (error: any) {
    logger.error('Error reading user images:', error);
    return [];
  }
}

/**
 * Enforce per-user image limit
 * Deletes oldest images if limit is exceeded
 */
export async function enforceUserLimit(userId: string): Promise<number> {
  const images = getUserImages(userId);

  if (images.length <= IMAGE_PER_USER_LIMIT) {
    return 0;
  }

  // Delete oldest images
  const toDelete = images.slice(IMAGE_PER_USER_LIMIT);
  let deletedCount = 0;

  for (const image of toDelete) {
    try {
      const imageId = image.filename.replace('.png', '');
      await deleteImage(userId, imageId);
      deletedCount++;
    } catch (error) {
      logger.error(`Failed to delete image ${image.filename}:`, error);
    }
  }

  logger.info(`Enforced user limit for ${userId}: deleted ${deletedCount} old images`);
  return deletedCount;
}

/**
 * Clean up old images across all users
 * Returns number of images deleted
 */
export async function cleanupOldImages(olderThanDays: number = IMAGE_MAX_AGE_DAYS): Promise<number> {
  if (!fs.existsSync(IMAGE_STORAGE_PATH)) {
    return 0;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  let deletedCount = 0;

  try {
    const userDirs = fs.readdirSync(IMAGE_STORAGE_PATH);

    for (const userId of userDirs) {
      const userDir = path.join(IMAGE_STORAGE_PATH, userId);
      const stats = fs.statSync(userDir);

      if (!stats.isDirectory()) {
        continue;
      }

      const images = getUserImages(userId);

      for (const image of images) {
        if (image.createdAt < cutoffDate) {
          try {
            const imageId = image.filename.replace('.png', '');
            await deleteImage(userId, imageId);
            deletedCount++;
          } catch (error) {
            logger.error(`Failed to delete old image ${image.filename}:`, error);
          }
        }
      }
    }

    logger.info(`Cleanup completed: deleted ${deletedCount} images older than ${olderThanDays} days`);
    return deletedCount;
  } catch (error: any) {
    logger.error('Cleanup error:', error);
    return deletedCount;
  }
}

/**
 * Get storage statistics
 */
export function getStorageStats(): {
  totalImages: number;
  totalSizeBytes: number;
  userCount: number;
  storagePath: string;
} {
  if (!fs.existsSync(IMAGE_STORAGE_PATH)) {
    return {
      totalImages: 0,
      totalSizeBytes: 0,
      userCount: 0,
      storagePath: IMAGE_STORAGE_PATH
    };
  }

  try {
    const userDirs = fs.readdirSync(IMAGE_STORAGE_PATH);
    let totalImages = 0;
    let totalSizeBytes = 0;
    let userCount = 0;

    for (const userId of userDirs) {
      const userDir = path.join(IMAGE_STORAGE_PATH, userId);
      const stats = fs.statSync(userDir);

      if (!stats.isDirectory()) {
        continue;
      }

      userCount++;
      const images = getUserImages(userId);
      totalImages += images.length;
      totalSizeBytes += images.reduce((sum, img) => sum + img.size, 0);
    }

    return {
      totalImages,
      totalSizeBytes,
      userCount,
      storagePath: IMAGE_STORAGE_PATH
    };
  } catch (error: any) {
    logger.error('Error getting storage stats:', error);
    return {
      totalImages: 0,
      totalSizeBytes: 0,
      userCount: 0,
      storagePath: IMAGE_STORAGE_PATH
    };
  }
}

/**
 * Generate a unique image ID
 */
export function generateImageId(predictionId?: string): string {
  if (predictionId) {
    // Use prediction ID if available for traceability
    return `img_${predictionId}_${Date.now()}`;
  }
  // Otherwise generate random ID
  return `img_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
}
