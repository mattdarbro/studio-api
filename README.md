# Studio API

A centralized TypeScript Express API gateway for accessing LLM providers (OpenAI, Anthropic, ElevenLabs, etc.).

## Features

- **Multi-provider support**: Currently supports OpenAI with extensible architecture for more providers
- **Model registry**: Single source of truth for model configurations via `model-catalog.json`
- **Channel-based routing**: Support for `stable`, `beta`, and custom release channels
- **Flexible authentication**: JWT tokens or app-key based authentication
- **Rate limiting**: In-memory rate limiting (120 requests/minute per user)
- **User-provided keys**: Optional support for users to bring their own API keys

## Quick Setup

### 1. Install Dependencies

```bash
cd studio-api
npm install
```

### 2. Configure Environment

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` and add your keys:

```env
OPENAI_API_KEY=sk-your-openai-key
APP_KEY=your-secret-app-key
APP_JWT_SECRET=your-jwt-secret
PORT=3000
```

### 3. Run Locally

Development mode (with auto-reload):
```bash
npm run dev
```

Production build:
```bash
npm run build
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### GET /v1/models

Returns the full model catalog configuration.

**Example:**
```bash
curl http://localhost:3000/v1/models \
  -H "x-app-key: your-secret-app-key"
```

### POST /v1/chat

Send chat completion requests.

**Headers:**
- `Authorization: Bearer <jwt>` OR `x-app-key: <app-key>` (required)
- `x-model-channel: stable|beta` (optional, defaults to `stable`)
- `x-user-openai-key: <user-key>` (optional, use user's own API key)

**Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "kind": "chat.default"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -H "x-app-key: your-secret-app-key" \
  -H "x-model-channel: stable" \
  -d '{
    "messages": [
      { "role": "user", "content": "What is 2+2?" }
    ]
  }'
```

### GET /v1/ephemeral

Create ephemeral realtime session tokens.

**Headers:**
- `Authorization: Bearer <jwt>` OR `x-app-key: <app-key>` (required)
- `x-model-channel: stable|beta` (optional, defaults to `stable`)
- `x-user-openai-key: <user-key>` (optional)

**Example:**
```bash
curl http://localhost:3000/v1/ephemeral \
  -H "x-app-key: your-secret-app-key"
```

### GET /health

Health check endpoint (no authentication required).

**Example:**
```bash
curl http://localhost:3000/health
```

## Authentication

### Option 1: App Key

Simple shared secret authentication for server-to-server communication.

```bash
curl -H "x-app-key: your-secret-app-key" http://localhost:3000/v1/models
```

### Option 2: JWT Token

For user-specific authentication. Create JWT tokens with your `APP_JWT_SECRET`.

```bash
curl -H "Authorization: Bearer <your-jwt-token>" http://localhost:3000/v1/chat
```

JWT payload should include:
```json
{
  "id": "user-123",
  "email": "user@example.com"
}
```

### Option 3: User-Provided Keys

Users can optionally provide their own OpenAI API keys:

```bash
curl -H "x-app-key: your-secret-app-key" \
     -H "x-user-openai-key: sk-user-openai-key" \
     http://localhost:3000/v1/chat
```

## Model Configuration

Edit `model-catalog.json` to configure available models:

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
        "model": "gpt-4o-realtime-preview"
      }
    },
    "beta": {
      "chat.default": {
        "provider": "openai",
        "model": "gpt-4-turbo"
      }
    }
  },
  "deprecated": []
}
```

## Rate Limiting

- **Limit**: 120 requests per minute per user/app
- **Implementation**: In-memory (resets on server restart)
- **Response**: HTTP 429 when exceeded

## Error Handling

All errors return JSON with consistent format:

```json
{
  "error": "Error message description"
}
```

Common status codes:
- `400` - Bad request (invalid parameters)
- `401` - Unauthorized (invalid or missing authentication)
- `429` - Rate limit exceeded
- `500` - Internal server error

## Development

### Project Structure

```
studio-api/
├── src/
│   ├── index.ts              # Express server setup
│   ├── auth.ts               # Authentication middleware
│   ├── rateLimit.ts          # Rate limiting middleware
│   ├── models.ts             # Model registry & resolver
│   ├── providers/
│   │   └── openai.ts         # OpenAI API integration
│   └── routes/
│       ├── chat.ts           # POST /v1/chat
│       └── ephemeral.ts      # GET /v1/ephemeral
├── model-catalog.json        # Model configuration
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Adding New Providers

1. Create a new file in `src/providers/`
2. Implement provider-specific API calls
3. Update `src/routes/` to route to the new provider
4. Add provider models to `model-catalog.json`

## License

MIT
