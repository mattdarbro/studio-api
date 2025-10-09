# Studio API Integration Guide

## Overview

Studio API (Lucid) is a centralized LLM provider gateway that manages model routing, authentication, and API key management for your applications.

**Production URL:** `https://studio-api-production-3deb.up.railway.app`

## Supported Providers

- ✅ **OpenAI** - Chat completions, realtime API
- ✅ **Replicate** - Image generation (Flux models)
- ✅ **ElevenLabs** - Music generation

**Coming Soon:**
- ❌ Anthropic (Claude)
- ❌ Google (Gemini)
- ❌ More image models

See [ROADMAP.md](./ROADMAP.md) for the full roadmap.

## Authentication

All endpoints (except `/health`) require authentication via one of two methods:

### Method 1: App Key (Recommended for server-side)
```bash
curl -H "x-app-key: YOUR_APP_KEY" https://studio-api-production-3deb.up.railway.app/v1/models
```

### Method 2: JWT Token (Recommended for user-specific access)
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" https://studio-api-production-3deb.up.railway.app/v1/models
```

## API Keys

### Server-Managed Keys
If Studio API has `OPENAI_API_KEY` configured, it will use that by default.

### User-Provided Keys
Users can provide their own API keys for any provider:
```bash
# OpenAI key
curl -H "x-app-key: YOUR_APP_KEY" \
     -H "x-user-openai-key: sk-..." \
     https://studio-api-production-3deb.up.railway.app/v1/chat

# Replicate key
curl -H "x-app-key: YOUR_APP_KEY" \
     -H "x-user-replicate-key: r8_..." \
     https://studio-api-production-3deb.up.railway.app/v1/images

# ElevenLabs key
curl -H "x-app-key: YOUR_APP_KEY" \
     -H "x-user-elevenlabs-key: el_..." \
     https://studio-api-production-3deb.up.railway.app/v1/music
```

## Model Channels

Control which model version to use via the `x-model-channel` header:

- `stable` (default) - Production-ready models
- `experimental` - Latest/beta models
- `fast` - Optimized for speed
- `quality` - Optimized for quality

```bash
curl -H "x-app-key: YOUR_APP_KEY" \
     -H "x-model-channel: experimental" \
     https://studio-api-production-3deb.up.railway.app/v1/chat
```

## Endpoints

### GET /health
Health check endpoint (no auth required)

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-08T20:46:51.211Z"
}
```

### GET /v1/models
Get available model catalog

**Headers:**
- `x-app-key` or `Authorization: Bearer <token>` (required)
- `x-model-channel` (optional, default: "stable")

**Response:**
```json
{
  "channels": {
    "stable": {
      "chat.default": {
        "provider": "openai",
        "model": "gpt-4"
      },
      "realtime.default": {
        "provider": "openai",
        "model": "gpt-4o-realtime-preview-2024-10-01"
      }
    }
  },
  "deprecated": []
}
```

### POST /v1/chat
Send chat completion request

**Headers:**
- `x-app-key` or `Authorization: Bearer <token>` (required)
- `x-model-channel` (optional, default: "stable")
- `x-user-openai-key` (optional, user's own API key)

**Request Body:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "kind": "chat.default"
}
```

**Response:** Standard OpenAI chat completion response

**Example:**
```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/chat \
  -H "Content-Type: application/json" \
  -H "x-app-key: YOUR_APP_KEY" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "kind": "chat.default"
  }'
```

### GET /v1/ephemeral
Get ephemeral token for realtime API

**Headers:**
- `x-app-key` or `Authorization: Bearer <token>` (required)
- `x-model-channel` (optional, default: "stable")
- `x-user-openai-key` (optional, user's own API key)

**Response:**
```json
{
  "client_secret": {
    "value": "ek_...",
    "expires_at": 1234567890
  }
}
```

**Example:**
```bash
curl https://studio-api-production-3deb.up.railway.app/v1/ephemeral \
  -H "x-app-key: YOUR_APP_KEY"
```

### POST /v1/images
Generate images using Replicate

**Headers:**
- `x-app-key` or `Authorization: Bearer <token>` (required)
- `x-model-channel` (optional, default: "stable")
- `x-user-replicate-key` (optional, user's own API key)

**Request Body:**
```json
{
  "prompt": "a cat wearing sunglasses on a beach",
  "kind": "image.default",
  "width": 1024,
  "height": 1024,
  "num_outputs": 1,
  "wait": true
}
```

**Parameters:**
- `prompt` (required): Text description of the image
- `kind` (optional): Model kind (e.g., "image.default", "image.flux-dev", "image.flux-pro")
- `width` (optional): Image width in pixels (default: 1024)
- `height` (optional): Image height in pixels (default: 1024)
- `num_outputs` (optional): Number of images to generate (default: 1)
- `wait` (optional): If true, waits for generation to complete before responding (default: true)

**Response (when wait=true):**
```json
{
  "id": "prediction-id",
  "status": "succeeded",
  "output": ["https://replicate.delivery/..."],
  "urls": {
    "get": "https://api.replicate.com/v1/predictions/...",
    "cancel": "https://api.replicate.com/v1/predictions/.../cancel"
  }
}
```

**Response (when wait=false):**
```json
{
  "id": "prediction-id",
  "status": "processing",
  "urls": {
    "get": "https://api.replicate.com/v1/predictions/..."
  }
}
```

**Example:**
```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/images \
  -H "Content-Type: application/json" \
  -H "x-app-key: YOUR_APP_KEY" \
  -d '{
    "prompt": "a futuristic city at sunset",
    "kind": "image.flux-schnell",
    "width": 1024,
    "height": 1024
  }'
```

### GET /v1/images/:id
Check status of an image generation

**Headers:**
- `x-app-key` or `Authorization: Bearer <token>` (required)
- `x-user-replicate-key` (optional)

**Response:**
```json
{
  "id": "prediction-id",
  "status": "succeeded",
  "output": ["https://replicate.delivery/..."]
}
```

### POST /v1/music
Generate music using ElevenLabs

**Headers:**
- `x-app-key` or `Authorization: Bearer <token>` (required)
- `x-model-channel` (optional, default: "stable")
- `x-user-elevenlabs-key` (optional, user's own API key)

**Request Body:**
```json
{
  "prompt": "upbeat electronic music with piano",
  "kind": "music.default",
  "duration": 30
}
```

**Parameters:**
- `prompt` (required): Text description of the music
- `kind` (optional): Model kind (default: "music.default")
- `duration` (optional): Duration in seconds, 1-300 (default: 30)

**Response:**
```json
{
  "generation_id": "gen_...",
  "status": "completed",
  "audio_url": "https://...",
  "audio_base64": "..."
}
```

**Example:**
```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/music \
  -H "Content-Type: application/json" \
  -H "x-app-key: YOUR_APP_KEY" \
  -d '{
    "prompt": "peaceful ambient music for meditation",
    "duration": 60
  }'
```

## Model Kinds

Available model kinds (configurable in `model-catalog.json`):

**Chat:**
- `chat.default` - Standard chat completion (GPT-4)

**Realtime:**
- `realtime.default` - Realtime audio/voice API

**Images:**
- `image.default` - Fast image generation (Flux Schnell)
- `image.flux-dev` - High quality (Flux Dev)
- `image.flux-pro` - Professional quality (Flux Pro)

**Music:**
- `music.default` - Music generation (ElevenLabs)

## Rate Limiting

Studio API includes built-in rate limiting:
- 100 requests per 15 minutes per user/IP
- Rate limit headers included in responses

## Error Responses

All errors return JSON with an `error` field:

**Authentication Error (401):**
```json
{
  "error": "Authentication required: provide Bearer token or x-app-key header"
}
```

**Invalid App Key (401):**
```json
{
  "error": "Invalid app key"
}
```

**Missing Messages (400):**
```json
{
  "error": "messages array is required and must not be empty"
}
```

**Model Not Found (500):**
```json
{
  "error": "Model kind \"invalid\" not found in channel \"stable\" or stable fallback"
}
```

## Migration Checklist

When migrating an app to use Studio API:

- [ ] Replace direct OpenAI API calls with Studio API endpoints
- [ ] Update base URL to `https://studio-api-production-3deb.up.railway.app`
- [ ] Add `x-app-key` header to all requests
- [ ] Remove OpenAI API key from client-side code (if any)
- [ ] Update chat endpoint from `/v1/chat/completions` to `/v1/chat`
- [ ] Update model selection to use `kind` parameter instead of `model`
- [ ] Add model channel selection if needed (`x-model-channel` header)
- [ ] Test with health check endpoint first
- [ ] Handle new error response format

## Example Migration

### Before (Direct OpenAI):
```javascript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

### After (Studio API):
```javascript
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
  method: 'POST',
  headers: {
    'x-app-key': APP_KEY,
    'Content-Type': 'application/json',
    // Optional: let users provide their own key
    // 'x-user-openai-key': userApiKey,
    // Optional: select model channel
    // 'x-model-channel': 'experimental',
  },
  body: JSON.stringify({
    kind: 'chat.default',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

## Environment Variables Needed

Your apps will need:

```env
# Required
STUDIO_API_URL=https://studio-api-production-3deb.up.railway.app
STUDIO_API_KEY=<your-app-key>

# Optional
STUDIO_API_CHANNEL=stable
```

## Testing

Test the connection:
```bash
# Health check (no auth)
curl https://studio-api-production-3deb.up.railway.app/health

# Get models (with auth)
curl -H "x-app-key: YOUR_APP_KEY" \
  https://studio-api-production-3deb.up.railway.app/v1/models

# Chat request (with auth)
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/chat \
  -H "Content-Type: application/json" \
  -H "x-app-key: YOUR_APP_KEY" \
  -d '{"messages":[{"role":"user","content":"test"}],"kind":"chat.default"}'
```

## Support

- Check deployment logs in Railway for API errors
- Health endpoint: `https://studio-api-production-3deb.up.railway.app/health`
- All requests are logged with timestamps for debugging
