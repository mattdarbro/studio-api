# Image Hosting Service - Implementation Plan

## Overview
Host Replicate-generated images through Studio API to provide stable URLs for CloudKit sync.

## Problem Statement
App 10202 generates images via Replicate but struggles to sync them to CloudKit because:
- Replicate URLs are temporary and expire
- CloudKit sync is asynchronous and may fail if URL expires
- No reliable way to re-download images after generation

## Proposed Solution
Studio API downloads and hosts images, providing stable, permanent URLs.

## Architecture

### Storage Options

#### Option 1: Railway Persistent Volume (Recommended for MVP)
**Pros:**
- Simple implementation
- No external dependencies
- Free (included with Railway)
- Fast local access

**Cons:**
- Limited storage (~10GB typical)
- Single point of failure
- Harder to scale horizontally

**Implementation:**
1. Mount volume at `/data` in Railway
2. Store images in `/data/images/{userId}/{imageId}.png`
3. Serve via Express static middleware or custom route

#### Option 2: Cloud Storage (S3/R2)
**Pros:**
- Unlimited storage
- Highly available
- CDN-ready
- Scalable

**Cons:**
- Additional costs ($0.023/GB/month for S3)
- External dependency
- More complex setup
- Requires AWS SDK

**Estimated costs for 1000 images/month:**
- Average image size: ~2MB
- Storage: 2GB/month = $0.046/month
- Bandwidth: ~2GB download = $0.18/month
- **Total: ~$0.23/month**

### Recommended Approach
**Start with Railway Volume, migrate to S3 if needed**

## Implementation Details

### 1. New Service: Image Storage
File: `src/services/imageStorage.ts`

```typescript
- downloadImage(url: string): Promise<Buffer>
- saveImage(buffer: Buffer, userId: string, imageId: string): Promise<string>
- getImagePath(userId: string, imageId: string): string
- deleteImage(userId: string, imageId: string): Promise<void>
- cleanupOldImages(olderThanDays: number): Promise<number>
```

### 2. Modified Endpoint: /v1/images/generate
**Changes:**
- After Replicate generation succeeds
- Download image from Replicate URL
- Save to persistent storage
- Return Studio API URL instead of Replicate URL

**New Response:**
```json
{
  "url": "https://studio-api.railway.app/v1/images/hosted/user123/img_abc123.png",
  "replicate_url": "https://replicate.delivery/...",  // Optional, for debugging
  "size_bytes": 2048576,
  "hosted_at": "2025-11-28T..."
}
```

### 3. New Endpoint: GET /v1/images/hosted/:userId/:imageId
**Purpose:** Serve hosted images
**Auth:** Optional (public by default, can add auth if needed)
**Features:**
- Streaming for large images
- Proper content-type headers
- Cache headers (1 year)
- 404 if not found

### 4. Image Metadata Storage
**Option A: Database Table**
```sql
CREATE TABLE hosted_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  replicate_prediction_id TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  content_type TEXT DEFAULT 'image/png',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  accessed_at TEXT,  -- For cleanup
  expires_at TEXT    -- Optional expiration
);
```

**Option B: Filesystem Only** (Simpler for MVP)
- No database, just files
- Use filename conventions: `{userId}_{timestamp}_{predictionId}.png`

### 5. Cleanup Strategy
**Problem:** Storage will fill up over time
**Solutions:**
1. **TTL-based:** Delete images older than 30 days
2. **LRU:** Delete least recently accessed when space low
3. **User quota:** Limit per-user storage (e.g., 10 images max)

**Recommended:** Combination
- Keep images for 90 days minimum
- Per-user limit of 50 images
- Cleanup job runs daily

### 6. Security Considerations
**Access Control:**
- Public URLs by default (simpler for CloudKit)
- Optional: Signed URLs with expiration
- Optional: User-specific access (only owner can download)

**Rate Limiting:**
- Separate rate limit for image downloads
- Prevent abuse/hotlinking

### 7. Railway Configuration
**Volume Setup:**
```yaml
services:
  studio-api:
    volumes:
      - /data
```

**Environment Variables:**
```bash
IMAGE_STORAGE_PATH=/data/images
IMAGE_MAX_AGE_DAYS=90
IMAGE_PER_USER_LIMIT=50
IMAGE_HOSTING_ENABLED=true
```

## Implementation Steps

### Phase 1: Basic Hosting (MVP)
1. Create image storage service
2. Modify `/v1/images/generate` to download and store
3. Add `GET /v1/images/hosted/:userId/:imageId` endpoint
4. Test with app 10202

### Phase 2: Metadata & Cleanup
5. Add database table for image metadata
6. Implement cleanup job (daily cron)
7. Add monitoring/logging

### Phase 3: Advanced Features (Optional)
8. Signed URLs with expiration
9. User dashboard to view/manage images
10. Migration to S3 if volume limits hit

## Testing Plan

### Unit Tests
- Image download from Replicate URL
- File save/retrieve operations
- Path generation
- Cleanup logic

### Integration Tests
- Full flow: Generate → Store → Serve
- 404 handling for missing images
- Large image handling (>10MB)
- CloudKit sync verification

### Load Tests
- 100 concurrent image generations
- 1000 images stored
- Serve 100 images simultaneously

## Risks & Mitigation

| Risk | Mitigation |
|------|-----------|
| Storage fills up | Implement cleanup, monitoring, alerts |
| Replicate download fails | Retry logic, fallback to original URL |
| High bandwidth costs | Add CDN, implement caching |
| Image corruption | Validate images before saving |
| Slow performance | Implement streaming, compression |

## Success Metrics
- 99% image availability after 7 days
- < 500ms image serve latency
- 0 CloudKit sync failures
- < 10GB storage usage for 1000 users

## Future Enhancements
1. Image optimization/compression
2. Multiple sizes (thumbnail, full)
3. WebP format support
4. CDN integration
5. Analytics (views, downloads)
6. Batch download/zip

## Cost Estimate (Railway Volume)
- Storage: Free (included)
- Bandwidth: Included in Railway plan
- Compute: No additional cost

**Total Additional Cost: $0/month** (with Railway volume)

## Timeline
- Phase 1 (MVP): 2-3 hours
- Phase 2 (Cleanup): 1-2 hours
- Phase 3 (Advanced): 4-6 hours

**Total: 7-11 hours for full implementation**
