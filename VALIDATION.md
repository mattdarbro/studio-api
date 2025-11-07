# Session-Based Authentication with /v1/validate

## Overview

The `/v1/validate` endpoint provides a session-based authentication system that improves performance and security for your Studio API integration. Instead of validating JWT tokens or app keys on every request, you exchange your credentials once for a short-lived session token.

**Production Endpoint:** `https://studio-api-production-3deb.up.railway.app/v1/validate`

## Why Use Session Tokens?

### Benefits

- **Performance**: Session validation uses fast Map lookups instead of expensive JWT cryptographic verification on every request
- **Security**: Short-lived tokens (15 minutes) reduce exposure if compromised
- **Simplicity**: One token instead of managing multiple authentication headers
- **Channel Locking**: Model channel is selected once at session creation
- **User Key Management**: User-provided API keys are stored securely in the session

### When to Use

- **Long-running applications**: Keep users authenticated without repeated JWT verification
- **High-traffic apps**: Reduce computational overhead of authentication
- **Client-side apps**: Minimize exposed credentials after initial authentication
- **Multi-provider apps**: Store user API keys for multiple providers in one session

## API Reference

### POST /v1/validate

Create a new session and receive a session token.

**Endpoint:** `POST /v1/validate`

**Headers:**

```
x-app-key: <your-app-key>                    (Option 1: App Key)
Authorization: Bearer <jwt-token>            (Option 2: JWT Token)
x-model-channel: stable|beta|fast            (optional, defaults to 'stable')
x-user-openai-key: <user-api-key>           (optional)
x-user-anthropic-key: <user-api-key>        (optional)
x-user-grok-key: <user-api-key>             (optional)
x-user-replicate-key: <user-api-key>        (optional)
x-user-elevenlabs-key: <user-api-key>       (optional)
```

**Response:**

```json
{
  "sessionToken": "base64url-encoded-token",
  "expiresIn": 900,
  "userId": "user-id-or-app",
  "userType": "jwt" | "app-key",
  "channel": "stable"
}
```

**Example (App Key):**

```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate \
  -H "x-app-key: YOUR_APP_KEY" \
  -H "x-model-channel: stable"
```

**Example (JWT):**

```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "x-model-channel: stable"
```

**Example (With User Keys):**

```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate \
  -H "x-app-key: YOUR_APP_KEY" \
  -H "x-user-openai-key: sk-user-key" \
  -H "x-user-anthropic-key: sk-ant-user-key"
```

### POST /v1/validate/refresh

Extend an existing session by another 15 minutes without re-authenticating.

**Endpoint:** `POST /v1/validate/refresh`

**Headers:**

```
x-session-token: <session-token>
```

**Response:**

```json
{
  "success": true,
  "expiresIn": 900
}
```

**Example:**

```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate/refresh \
  -H "x-session-token: YOUR_SESSION_TOKEN"
```

### POST /v1/validate/revoke

Revoke (logout) a session token immediately.

**Endpoint:** `POST /v1/validate/revoke`

**Headers:**

```
x-session-token: <session-token>
```

**Response:**

```json
{
  "success": true
}
```

**Example:**

```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate/revoke \
  -H "x-session-token: YOUR_SESSION_TOKEN"
```

### GET /v1/validate/stats

Get session statistics for monitoring (requires valid app key).

**Endpoint:** `GET /v1/validate/stats`

**Headers:**

```
x-app-key: <your-app-key>
```

**Response:**

```json
{
  "total": 15,
  "active": 12,
  "expired": 3
}
```

## Authentication Methods

### Method 1: App Key (Server-Side)

Use your app key for server-to-server authentication.

```javascript
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
  method: 'POST',
  headers: {
    'x-app-key': process.env.STUDIO_API_KEY,
    'x-model-channel': 'stable',
  }
});

const { sessionToken } = await response.json();
```

### Method 2: JWT Token (User-Specific)

Use JWT tokens for user-specific sessions.

```javascript
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userJwtToken}`,
    'x-model-channel': 'stable',
  }
});

const { sessionToken, userId } = await response.json();
```

## Session Lifecycle

### 1. Creation

Sessions are created when you call `/v1/validate` with valid credentials.

```javascript
const { sessionToken, expiresIn, channel } = await createSession();
// sessionToken: unique token for this session
// expiresIn: 900 seconds (15 minutes)
// channel: 'stable', 'beta', or 'fast'
```

### 2. Usage

Use the session token for all API calls instead of your original credentials.

```javascript
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken,  // Use session token
  },
  body: JSON.stringify({
    kind: 'chat.default',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

### 3. Expiration

Sessions expire after 15 minutes of inactivity. You'll receive a 401 error:

```json
{
  "error": "Invalid or expired session token"
}
```

### 4. Refresh or Re-authenticate

Before expiration, you can either:
- **Refresh**: Extend the current session
- **Re-authenticate**: Get a new session token

## Legacy App Migration Roadmap

Follow these steps to migrate your existing apps to use session-based authentication.

### Step 1: Add Validation Call at Startup

Add a function to create a session when your app starts or when a user logs in.

```javascript
// Store these at module/app level
let sessionToken = null;
let sessionExpiresAt = null;

async function initializeSession() {
  try {
    const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
      method: 'POST',
      headers: {
        'x-app-key': process.env.STUDIO_API_KEY,
        'x-model-channel': 'stable',
      }
    });

    if (!response.ok) {
      throw new Error(`Validation failed: ${response.status}`);
    }

    const data = await response.json();
    sessionToken = data.sessionToken;
    sessionExpiresAt = Date.now() + (data.expiresIn * 1000);

    console.log('Session created:', {
      userId: data.userId,
      channel: data.channel,
      expiresAt: new Date(sessionExpiresAt)
    });

    return sessionToken;
  } catch (error) {
    console.error('Failed to create session:', error);
    throw error;
  }
}

// Call during app initialization
initializeSession();
```

### Step 2: Store Session Token Securely

Choose appropriate storage based on your app type:

**Server-Side (Node.js):**
```javascript
// In-memory (simple)
let sessionToken = null;

// Or use a session store
const sessionStore = new Map();
```

**Client-Side (Browser):**
```javascript
// Memory only (most secure, lost on refresh)
let sessionToken = null;

// SessionStorage (lost when tab closes)
sessionStorage.setItem('studioSessionToken', sessionToken);

// LocalStorage (persists, use with caution)
localStorage.setItem('studioSessionToken', sessionToken);
```

**React Example:**
```javascript
import { useState, useEffect } from 'react';

function useStudioSession() {
  const [sessionToken, setSessionToken] = useState(null);

  useEffect(() => {
    initializeSession().then(setSessionToken);
  }, []);

  return sessionToken;
}
```

### Step 3: Replace Auth Headers in API Calls

**Before (Direct Authentication):**
```javascript
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-app-key': APP_KEY,  // ❌ Sent on every request
  },
  body: JSON.stringify({
    kind: 'chat.default',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

**After (Session Token):**
```javascript
const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken,  // ✅ Fast validation
  },
  body: JSON.stringify({
    kind: 'chat.default',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

### Step 4: Implement Session Refresh Strategy

Choose one of these patterns based on your needs.

### Step 5: Handle Expiration and Errors

Implement error handling to detect and recover from expired sessions.

```javascript
async function makeAPICall(endpoint, data) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      body: JSON.stringify(data),
    });

    if (response.status === 401) {
      console.log('Session expired, re-authenticating...');
      await initializeSession();
      
      // Retry the request with new token
      return makeAPICall(endpoint, data);
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}
```

## Implementation Patterns

### Pattern 1: Proactive Refresh (Recommended)

Automatically refresh the session before it expires. Best for long-running applications.

```javascript
let sessionToken = null;
let sessionExpiresAt = null;
let refreshTimer = null;

async function createSession() {
  const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
    method: 'POST',
    headers: {
      'x-app-key': process.env.STUDIO_API_KEY,
    }
  });

  const data = await response.json();
  sessionToken = data.sessionToken;
  sessionExpiresAt = Date.now() + (data.expiresIn * 1000);

  // Schedule refresh 2 minutes before expiration
  scheduleRefresh(data.expiresIn - 120);

  return sessionToken;
}

async function refreshSession() {
  try {
    const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate/refresh', {
      method: 'POST',
      headers: {
        'x-session-token': sessionToken,
      }
    });

    const data = await response.json();

    if (data.success) {
      sessionExpiresAt = Date.now() + (data.expiresIn * 1000);
      console.log('Session refreshed, new expiry:', new Date(sessionExpiresAt));
      
      // Schedule next refresh
      scheduleRefresh(data.expiresIn - 120);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Failed to refresh session:', error);
    return false;
  }
}

function scheduleRefresh(delaySeconds) {
  if (refreshTimer) clearTimeout(refreshTimer);

  refreshTimer = setTimeout(async () => {
    const refreshed = await refreshSession();
    
    if (!refreshed) {
      console.log('Refresh failed, creating new session...');
      await createSession();
    }
  }, delaySeconds * 1000);
}

// Initialize on startup
createSession();
```

### Pattern 2: Reactive Re-authentication

Wait for 401 errors and re-authenticate on demand. Simpler but causes failed requests.

```javascript
let sessionToken = null;

async function callAPI(endpoint, data, retryCount = 0) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionToken,
    },
    body: JSON.stringify(data),
  });

  const result = await response.json();

  // Handle session expiration
  if (response.status === 401 && retryCount === 0) {
    console.log('Session expired, getting new token...');
    
    // Get fresh session token
    const validationResponse = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
      method: 'POST',
      headers: {
        'x-app-key': process.env.STUDIO_API_KEY,
      }
    });
    
    const { sessionToken: newToken } = await validationResponse.json();
    sessionToken = newToken;
    
    // Retry once
    return callAPI(endpoint, data, retryCount + 1);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${result.error}`);
  }

  return result;
}
```

### Pattern 3: Activity-Based Refresh

Refresh the session when the user is actively using the app.

```javascript
let sessionToken = null;
let sessionExpiresAt = null;
let lastActivityTime = Date.now();

function trackUserActivity() {
  lastActivityTime = Date.now();
  
  // Check if session will expire soon
  const timeUntilExpiry = sessionExpiresAt - Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  
  if (timeUntilExpiry < fiveMinutes && timeUntilExpiry > 0) {
    console.log('User active, refreshing session...');
    refreshSession();
  }
}

// Set up activity listeners (browser)
if (typeof window !== 'undefined') {
  window.addEventListener('click', trackUserActivity);
  window.addEventListener('keypress', trackUserActivity);
  window.addEventListener('scroll', trackUserActivity);
}

// Set up periodic check (every 2 minutes)
setInterval(() => {
  const inactiveDuration = Date.now() - lastActivityTime;
  const tenMinutes = 10 * 60 * 1000;
  
  // If user inactive for 10+ minutes, don't bother refreshing
  if (inactiveDuration < tenMinutes) {
    const timeUntilExpiry = sessionExpiresAt - Date.now();
    if (timeUntilExpiry < fiveMinutes && timeUntilExpiry > 0) {
      refreshSession();
    }
  }
}, 2 * 60 * 1000);
```

### Pattern 4: Combined Approach (Best Practice)

Combine proactive refresh with reactive re-authentication for maximum reliability.

```javascript
class StudioSessionManager {
  constructor(appKey) {
    this.appKey = appKey;
    this.sessionToken = null;
    this.sessionExpiresAt = null;
    this.refreshTimer = null;
  }

  async initialize() {
    return this.createSession();
  }

  async createSession() {
    try {
      const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
        method: 'POST',
        headers: {
          'x-app-key': this.appKey,
        }
      });

      const data = await response.json();
      this.sessionToken = data.sessionToken;
      this.sessionExpiresAt = Date.now() + (data.expiresIn * 1000);

      // Schedule proactive refresh
      this.scheduleRefresh(data.expiresIn - 120);

      console.log('Session created');
      return this.sessionToken;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  }

  async refreshSession() {
    try {
      const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate/refresh', {
        method: 'POST',
        headers: {
          'x-session-token': this.sessionToken,
        }
      });

      const data = await response.json();

      if (data.success) {
        this.sessionExpiresAt = Date.now() + (data.expiresIn * 1000);
        this.scheduleRefresh(data.expiresIn - 120);
        console.log('Session refreshed');
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to refresh:', error);
      return false;
    }
  }

  scheduleRefresh(delaySeconds) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    this.refreshTimer = setTimeout(async () => {
      const refreshed = await this.refreshSession();
      if (!refreshed) {
        await this.createSession();
      }
    }, delaySeconds * 1000);
  }

  async callAPI(endpoint, data, retryCount = 0) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': this.sessionToken,
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      // Reactive re-authentication on 401
      if (response.status === 401 && retryCount === 0) {
        console.log('Session expired unexpectedly, re-authenticating...');
        await this.createSession();
        return this.callAPI(endpoint, data, retryCount + 1);
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return result;
    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
  }

  async revoke() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    try {
      await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate/revoke', {
        method: 'POST',
        headers: {
          'x-session-token': this.sessionToken,
        }
      });
      console.log('Session revoked');
    } catch (error) {
      console.error('Failed to revoke session:', error);
    }

    this.sessionToken = null;
    this.sessionExpiresAt = null;
  }
}

// Usage
const sessionManager = new StudioSessionManager(process.env.STUDIO_API_KEY);
await sessionManager.initialize();

// Make API calls
const result = await sessionManager.callAPI(
  'https://studio-api-production-3deb.up.railway.app/v1/chat',
  {
    kind: 'chat.default',
    messages: [{ role: 'user', content: 'Hello!' }]
  }
);

// Clean up on logout/shutdown
await sessionManager.revoke();
```

## Error Handling

### Common Errors

**401 Unauthorized - Invalid Credentials:**
```json
{
  "error": "Invalid app key"
}
```

**Solution:** Check that your `APP_KEY` or JWT secret is correct.

**401 Unauthorized - Expired Session:**
```json
{
  "error": "Invalid or expired session token"
}
```

**Solution:** Create a new session or refresh before expiration.

**500 Server Configuration Error:**
```json
{
  "error": "Server configuration error: APP_KEY not set"
}
```

**Solution:** Contact your API administrator to configure server credentials.

### Error Handling Best Practices

```javascript
async function robustAPICall(endpoint, data) {
  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': sessionToken,
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.status === 401) {
        console.log(`Session invalid (attempt ${attempt + 1}/${maxRetries})`);
        await createSession();
        continue;  // Retry with new session
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status} - ${result.error}`);
      }

      return result;
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt + 1} failed:`, error);
      
      if (attempt < maxRetries - 1) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(`API call failed after ${maxRetries} attempts: ${lastError.message}`);
}
```

## Testing Your Migration

### Step 1: Test Session Creation

```bash
# Test app-key authentication
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate \
  -H "x-app-key: YOUR_APP_KEY" \
  -v

# Expected: 200 OK with sessionToken
```

### Step 2: Test API Call with Session Token

```bash
# Use the session token from step 1
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/chat \
  -H "Content-Type: application/json" \
  -H "x-session-token: YOUR_SESSION_TOKEN" \
  -d '{"kind":"chat.default","messages":[{"role":"user","content":"test"}]}'

# Expected: 200 OK with chat response
```

### Step 3: Test Session Refresh

```bash
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/validate/refresh \
  -H "x-session-token: YOUR_SESSION_TOKEN" \
  -v

# Expected: 200 OK with success: true
```

### Step 4: Test Expired Session

```bash
# Wait 15+ minutes or use an old token
curl -X POST https://studio-api-production-3deb.up.railway.app/v1/chat \
  -H "x-session-token: EXPIRED_TOKEN" \
  -d '{"kind":"chat.default","messages":[{"role":"user","content":"test"}]}'

# Expected: 401 Unauthorized
```

### Automated Testing Example

```javascript
describe('Studio API Session Management', () => {
  let sessionToken;

  test('should create session with app key', async () => {
    const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate', {
      method: 'POST',
      headers: {
        'x-app-key': process.env.STUDIO_API_KEY,
      }
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sessionToken).toBeDefined();
    expect(data.expiresIn).toBe(900);
    
    sessionToken = data.sessionToken;
  });

  test('should make API call with session token', async () => {
    const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      body: JSON.stringify({
        kind: 'chat.default',
        messages: [{ role: 'user', content: 'test' }]
      })
    });

    expect(response.status).toBe(200);
  });

  test('should refresh session', async () => {
    const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate/refresh', {
      method: 'POST',
      headers: {
        'x-session-token': sessionToken,
      }
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('should revoke session', async () => {
    const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/validate/revoke', {
      method: 'POST',
      headers: {
        'x-session-token': sessionToken,
      }
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('should reject revoked session token', async () => {
    const response = await fetch('https://studio-api-production-3deb.up.railway.app/v1/chat', {
      method: 'POST',
      headers: {
        'x-session-token': sessionToken,
      },
      body: JSON.stringify({
        kind: 'chat.default',
        messages: [{ role: 'user', content: 'test' }]
      })
    });

    expect(response.status).toBe(401);
  });
});
```

## Quick Reference

### Environment Variables

```bash
# Your app needs these
STUDIO_API_URL=https://studio-api-production-3deb.up.railway.app
STUDIO_API_KEY=your-app-key
STUDIO_API_CHANNEL=stable  # optional
```

### Headers Quick Reference

**Creating Session:**
- `x-app-key` OR `Authorization: Bearer <jwt>` (required)
- `x-model-channel` (optional)
- `x-user-*-key` (optional, for user-provided API keys)

**Using Session:**
- `x-session-token` (required for all API calls)

**Refreshing/Revoking:**
- `x-session-token` (required)

### Session Timing

- **Duration**: 15 minutes (900 seconds)
- **Recommended Refresh**: 13 minutes (780 seconds)
- **Cleanup Interval**: Server cleans expired sessions every 5 minutes

## Next Steps

1. Review your current authentication implementation
2. Choose an implementation pattern (recommend Pattern 4: Combined Approach)
3. Implement session creation at app startup
4. Replace auth headers with session tokens in API calls
5. Add session refresh logic
6. Test thoroughly with the testing guide above
7. Deploy and monitor session statistics

## Support

- **Integration Guide**: See [INTEGRATION.md](./INTEGRATION.md) for general API documentation
- **Health Check**: `https://studio-api-production-3deb.up.railway.app/health`
- **Session Stats**: `GET /v1/validate/stats` (requires app key)

For issues or questions, check your server logs or contact your API administrator.

