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

## Session-Based Authentication (Recommended)

For better performance and user experience, use **session tokens** instead of sending JWT/app-key on every request.

### How It Works

1. **Validate once**: Exchange your credentials for a session token
2. **Use everywhere**: Send the session token with all API calls
3. **Refresh**: Extend the session before it expires (15 minutes)

### Quick Start

**Step 1: Get a session token**
```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate \
  -H "x-app-key: YOUR_APP_KEY" \
  -H "x-model-channel: stable"

# Response:
# {
#   "sessionToken": "...",
#   "expiresIn": 900,
#   "userId": "app",
#   "channel": "stable"
# }
```

**Step 2: Use the session token**
```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/chat \
  -H "Content-Type: application/json" \
  -H "x-session-token: YOUR_SESSION_TOKEN" \
  -d '{"kind":"chat.default","messages":[{"role":"user","content":"Hello!"}]}'
```

**Step 3: Refresh before expiration (optional)**
```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate/refresh \
  -H "x-session-token: YOUR_SESSION_TOKEN"
```

### Benefits

- **Performance**: Map lookup vs expensive JWT verification on every request
- **Security**: Short-lived tokens (15 minutes) reduce exposure
- **Simplicity**: One token instead of multiple headers
- **User Keys**: Store user-provided API keys in the session

### Complete Guide

For detailed implementation patterns, error handling, and migration steps, see [VALIDATION.md](./VALIDATION.md).

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

### POST /v1/images/generate
Purpose-built endpoint for mobile apps (Arno) that returns the final URL.

**Headers:**
- `x-session-token` (recommended) or `x-app-key`/`Authorization` (fallback)

**Request Body:**
```json
{
  "prompt": "studio-quality product photo of a ceramic mug",
  "width": 1024,
  "height": 1024,
  "style": "photorealistic"
}
```

**Style Enum:** `photorealistic`, `artistic`, `abstract`, `minimalist`, `humorous`

**Response:**
```json
{
  "url": "https://replicate.delivery/.../out-0.png"
}
```

**Behavior:**
- Waits for Replicate prediction to finish (no polling needed)
- Returns 500 if generation fails, including Replicate error message
- Uses the default image model for the session's channel (typically `image.default`)

**Example:**
```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/images/generate \
  -H "Content-Type: application/json" \
  -H "x-session-token: YOUR_SESSION_TOKEN" \
  -d '{
    "prompt": "Bold comic-book illustration of a superhero corgi",
    "width": 1024,
    "height": 1024,
    "style": "humorous"
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

### Basic Migration
- [ ] Replace direct OpenAI API calls with Studio API endpoints
- [ ] Update base URL to `https://studio-api-production-3deb.up.railway.app`
- [ ] Update chat endpoint from `/v1/chat/completions` to `/v1/chat`
- [ ] Update model selection to use `kind` parameter instead of `model`
- [ ] Remove OpenAI API key from client-side code (if any)
- [ ] Test with health check endpoint first
- [ ] Handle new error response format

### Authentication Options

**Option A: Direct Authentication (Simple)**
- [ ] Add `x-app-key` or `Authorization: Bearer` header to all requests
- [ ] Add model channel selection if needed (`x-model-channel` header)

**Option B: Session Tokens (Recommended for Production)**
- [ ] Implement session token creation at app startup/login
- [ ] Store session token securely
- [ ] Replace `x-app-key`/JWT with `x-session-token` in API calls
- [ ] Implement session refresh strategy (proactive or reactive)
- [ ] Handle 401 errors by getting new session token
- [ ] See [VALIDATION.md](./VALIDATION.md) for complete migration guide

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

### After (Studio API - Direct Auth):
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

### After (Studio API - Session Token, Recommended):
```javascript
// Step 1: Get session token (once at startup)
const validateResponse = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
  method: 'POST',
  headers: {
    'x-app-key': APP_KEY,
    'x-model-channel': 'stable',
  }
});
const { sessionToken } = await validateResponse.json();

// Step 2: Use session token for all requests
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
  method: 'POST',
  headers: {
    'x-session-token': sessionToken,  // Faster than JWT verification
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    kind: 'chat.default',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

**Note:** For complete session management patterns and best practices, see [VALIDATION.md](./VALIDATION.md).

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

## Integrating Analytics into Legacy Apps

If you have existing applications and want to add the Studio API analytics dashboard, follow these steps:

### Prerequisites

Your legacy app needs to be modified to:
1. Route LLM requests through Studio API (instead of calling OpenAI/Anthropic directly)
2. Include identification headers so analytics can track per-app usage

### Step-by-Step Integration

#### 1. Update Your API Calls

Add Studio API headers to your existing LLM requests:

```javascript
// Before (Direct OpenAI call in legacy app):
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }]
});

// After (Through Studio API):
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-app-key': process.env.STUDIO_API_KEY,
    'x-app-id': 'my-legacy-app-name',  // ← Identifies your app in analytics
    'x-user-id': userId,                // ← Optional: track per-user usage
  },
  body: JSON.stringify({
    kind: 'chat.default',
    messages: [{ role: 'user', content: 'Hello' }]
  })
});
```

#### 2. Add App Identification

The analytics dashboard groups data by `app_id`. Make sure to include the `x-app-id` header:

```javascript
// Example: Identify different environments
const APP_ID = process.env.NODE_ENV === 'production'
  ? 'my-app-prod'
  : 'my-app-dev';

headers: {
  'x-app-id': APP_ID,  // Shows up as separate apps in analytics
}
```

#### 3. Configure Environment Variables

Update your legacy app's `.env` file:

```bash
# Add these to your existing environment variables:
STUDIO_API_URL=https://studio-api-production-3deb.up.railway.app
STUDIO_API_KEY=your-app-key-here

# Optional: Identify your app
APP_ID=my-legacy-app
```

#### 4. Set Up Analytics Dashboard

Once your app is making requests through Studio API:

1. **Deploy the dashboard** (see `dashboard/README.md`)
2. **Configure the dashboard** with:
   - API URL: `https://studio-api-production-3deb.up.railway.app`
   - APP_KEY: Same key your apps use
3. **Start querying** your usage data!

#### 5. Example Questions for Your Legacy App

Once integrated, you can ask questions like:

- "How much did my-legacy-app spend this week?"
- "Which users generated the most requests yesterday?"
- "Show me all failed requests for my-legacy-app"
- "What's the average response time by model?"

### Migration Patterns

#### Pattern 1: Wrapper Function (Minimal Changes)

Create a wrapper around your existing OpenAI calls:

```javascript
// utils/llm.js
async function chatCompletion(messages, userId = null) {
  const response = await fetch(`${process.env.STUDIO_API_URL}/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-key': process.env.STUDIO_API_KEY,
      'x-app-id': process.env.APP_ID,
      'x-user-id': userId,
    },
    body: JSON.stringify({
      kind: 'chat.default',
      messages,
    })
  });

  return response.json();
}

// Then replace all your OpenAI calls with:
// const result = await chatCompletion(messages, currentUser.id);
```

#### Pattern 2: Drop-in Replacement (Using OpenAI SDK)

If you're using the OpenAI SDK, you can point it to Studio API:

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://studio-api-production-3deb.up.railway.app/v1',
  apiKey: process.env.STUDIO_API_KEY,
  defaultHeaders: {
    'x-app-id': 'my-legacy-app',
    'x-user-id': userId,
  }
});

// Your existing OpenAI SDK calls will now route through Studio API
const response = await openai.chat.completions.create({
  model: 'chat.default',  // Use Studio API "kinds" instead
  messages: [{ role: 'user', content: 'Hello' }]
});
```

**Note:** This pattern has limitations - Studio API uses `kind` instead of `model`, so you'll need to adjust model selection logic.

#### Pattern 3: Gradual Migration

Migrate one feature at a time:

```javascript
const USE_STUDIO_API = process.env.ENABLE_STUDIO_API === 'true';

async function chatCompletion(messages) {
  if (USE_STUDIO_API) {
    // New: Studio API with analytics
    return await studioApiChat(messages);
  } else {
    // Old: Direct OpenAI
    return await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
    });
  }
}
```

Toggle with feature flag until confident in the migration.

### Tracking Multiple Legacy Apps

If you have several legacy apps, differentiate them with unique app IDs:

```javascript
// App 1: Mobile app
headers: { 'x-app-id': 'mobile-ios' }

// App 2: Web dashboard
headers: { 'x-app-id': 'web-dashboard' }

// App 3: Background jobs
headers: { 'x-app-id': 'background-worker' }
```

Then query analytics per app:

- "How much did mobile-ios spend vs web-dashboard?"
- "Show me background-worker usage this month"

### Troubleshooting

**My legacy app's data isn't showing up:**
- Check that `x-app-id` header is being sent
- Verify requests are going to Studio API (check network tab)
- Confirm Studio API has logging enabled (check Railway logs)

**Analytics shows 'unknown' app:**
- Your app is missing the `x-app-id` header
- Add it to all your API requests

**Costs seem wrong:**
- Verify the model kinds in your requests match the catalog
- Check `model-catalog.json` for correct pricing

### Next Steps

1. Choose a migration pattern above
2. Update one endpoint in your legacy app as a test
3. Verify it appears in analytics dashboard
4. Gradually migrate remaining endpoints
5. Decommission direct provider API keys once fully migrated

## Support

- Check deployment logs in Railway for API errors
- Health endpoint: `https://studio-api-production-3deb.up.railway.app/health`
- All requests are logged with timestamps for debugging
