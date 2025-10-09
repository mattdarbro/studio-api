# Lucid (Studio API) Roadmap

## Current Capabilities ✅

- **Chat Completions** via OpenAI (`/v1/chat`)
- **Realtime API** via OpenAI (`/v1/ephemeral`)
- Model routing with channels (stable, experimental, fast, quality)
- Authentication (app key, JWT)
- Rate limiting
- User-provided API keys

## Planned Provider Support

### Phase 1: Image Generation 🎨

**Replicate Integration**

Add support for image generation models through Replicate:

```typescript
// New endpoint
POST /v1/images

// Request
{
  "prompt": "a cat wearing sunglasses",
  "kind": "image.flux-schnell",  // or image.stable-diffusion, etc.
  "width": 1024,
  "height": 1024
}

// Response (Replicate style)
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

**Model Catalog Updates:**
```json
{
  "channels": {
    "stable": {
      "image.flux-schnell": {
        "provider": "replicate",
        "model": "black-forest-labs/flux-schnell"
      },
      "image.stable-diffusion": {
        "provider": "replicate",
        "model": "stability-ai/sdxl"
      }
    }
  }
}
```

**Implementation Tasks:**
- [ ] Create `/src/providers/replicate.ts`
- [ ] Add `POST /v1/images` endpoint in `/src/routes/images.ts`
- [ ] Support for user-provided Replicate API tokens (`x-user-replicate-key`)
- [ ] Handle async prediction polling
- [ ] Add webhook support for long-running predictions
- [ ] Update model catalog with image generation models

### Phase 2: Music Generation 🎵

**ElevenLabs Integration**

Add support for music generation through ElevenLabs:

```typescript
// New endpoint
POST /v1/music

// Request
{
  "prompt": "upbeat electronic music with piano",
  "kind": "music.default",
  "duration": 30  // seconds
}

// Response (ElevenLabs style)
{
  "audio_url": "https://elevenlabs.io/...",
  "generation_id": "...",
  "status": "completed"
}
```

**Model Catalog Updates:**
```json
{
  "channels": {
    "stable": {
      "music.default": {
        "provider": "elevenlabs",
        "model": "eleven_music_generation_v1"
      }
    }
  }
}
```

**Implementation Tasks:**
- [ ] Create `/src/providers/elevenlabs.ts`
- [ ] Add `POST /v1/music` endpoint in `/src/routes/music.ts`
- [ ] Support for user-provided ElevenLabs API keys (`x-user-elevenlabs-key`)
- [ ] Handle streaming responses
- [ ] Update model catalog with music models

### Phase 3: Vision & Multimodal 👁️

**OpenAI Vision / GPT-4 Vision**

Support image inputs in chat completions:

```typescript
// Enhanced /v1/chat endpoint
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "What's in this image?" },
        { "type": "image_url", "image_url": { "url": "https://..." } }
      ]
    }
  ],
  "kind": "chat.vision"
}
```

**Model Catalog Updates:**
```json
{
  "channels": {
    "stable": {
      "chat.vision": {
        "provider": "openai",
        "model": "gpt-4-vision-preview"
      }
    }
  }
}
```

### Phase 4: Additional Providers

**Anthropic (Claude)**
```typescript
POST /v1/chat
{
  "kind": "chat.claude-opus",
  "messages": [...]
}
```

**Google (Gemini)**
```typescript
POST /v1/chat
{
  "kind": "chat.gemini-pro",
  "messages": [...]
}
```

**Cohere**
```typescript
POST /v1/chat
{
  "kind": "chat.command-r",
  "messages": [...]
}
```

## Provider Architecture

### Generic Provider Interface

```typescript
// src/providers/base.ts
interface Provider {
  name: string;

  chat?(params: ChatParams): Promise<ChatResponse>;
  images?(params: ImageParams): Promise<ImageResponse>;
  music?(params: MusicParams): Promise<MusicResponse>;
  realtime?(params: RealtimeParams): Promise<RealtimeResponse>;
}

interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}
```

### Provider Registry

```typescript
// src/providers/registry.ts
const providers: Record<string, Provider> = {
  openai: new OpenAIProvider(),
  replicate: new ReplicateProvider(),
  elevenlabs: new ElevenLabsProvider(),
  anthropic: new AnthropicProvider(),
  // ... more providers
};

export function getProvider(name: string): Provider {
  return providers[name];
}
```

### Enhanced Model Catalog

```json
{
  "channels": {
    "stable": {
      "chat.default": {
        "provider": "openai",
        "model": "gpt-4",
        "capabilities": ["text"]
      },
      "chat.vision": {
        "provider": "openai",
        "model": "gpt-4-vision-preview",
        "capabilities": ["text", "images"]
      },
      "image.flux-schnell": {
        "provider": "replicate",
        "model": "black-forest-labs/flux-schnell",
        "capabilities": ["image-generation"]
      },
      "music.default": {
        "provider": "elevenlabs",
        "model": "eleven_music_generation_v1",
        "capabilities": ["music-generation"]
      }
    }
  }
}
```

## Migration Path for Arno

### Current State
Arno directly calls:
- Studio API for chat
- Replicate API for images
- ElevenLabs API for music

### After Phase 1 (Images)
Arno can route through Studio API:
- ✅ Studio API for chat
- ✅ Studio API for images (new!)
- ❌ ElevenLabs API for music (still direct)

### After Phase 2 (Music)
Arno fully routes through Studio API:
- ✅ Studio API for chat
- ✅ Studio API for images
- ✅ Studio API for music

### Benefits
- Single authentication point (one API key)
- Centralized rate limiting
- Cross-provider analytics and logging
- User can provide their own keys for any provider
- Model routing/fallbacks across providers
- Cost tracking per user/app

## Technical Considerations

### 1. Async Operations
Replicate and some other providers use async prediction APIs:
- Client POSTs → Gets prediction ID
- Client polls status until complete
- Alternative: Webhook delivery

**Solution:**
```typescript
// Option A: Polling support
POST /v1/images → { id, status: "processing" }
GET /v1/images/:id → { id, status: "succeeded", output: [...] }

// Option B: Webhooks
POST /v1/images
  + x-webhook-url header
  → Returns immediately with prediction ID
  → Calls webhook when complete
```

### 2. Different Response Formats
Each provider has different response structures.

**Solution:** Normalize to Lucid format
```typescript
interface LucidResponse {
  provider: string;
  model: string;
  result: {
    // Provider-specific data
  };
  metadata: {
    request_id: string;
    latency_ms: number;
    tokens_used?: number;
    cost_usd?: number;
  };
}
```

### 3. API Key Management
Support multiple provider keys per user:

```typescript
// Headers
x-user-openai-key: sk-...
x-user-replicate-key: r8_...
x-user-elevenlabs-key: el_...

// Or in one header (JSON)
x-user-api-keys: {
  "openai": "sk-...",
  "replicate": "r8_...",
  "elevenlabs": "el_..."
}
```

## Next Steps

1. **Immediate** - Document current limitations in INTEGRATION.md
2. **Phase 1 Start** - Implement Replicate provider for Arno's image needs
3. **Phase 2 Start** - Implement ElevenLabs provider for Arno's music needs
4. **Future** - Add more providers based on app needs

## Questions to Answer

- Should Lucid handle provider retries automatically?
- Should Lucid cache responses (e.g., same prompt = same image)?
- Should Lucid support provider fallbacks (if Replicate fails, try StabilityAI)?
- How should Lucid handle rate limits across different providers?
- Should Lucid provide cost estimation before making requests?
