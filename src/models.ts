import * as fs from 'fs';
import * as path from 'path';

interface ModelConfig {
  provider: string;
  model: string;
}

interface ModelCatalog {
  channels: {
    [channel: string]: {
      [kind: string]: ModelConfig;
    };
  };
  deprecated: string[];
}

let catalogCache: ModelCatalog | null = null;

function loadCatalog(): ModelCatalog {
  if (catalogCache) {
    return catalogCache;
  }

  const catalogPath = path.join(__dirname, '..', 'model-catalog.json');
  const catalogData = fs.readFileSync(catalogPath, 'utf-8');
  catalogCache = JSON.parse(catalogData);
  return catalogCache;
}

export function resolveModel(kind: string, channel: string = 'stable'): ModelConfig {
  const catalog = loadCatalog();

  // Try to find model in requested channel
  if (catalog.channels[channel] && catalog.channels[channel][kind]) {
    const config = catalog.channels[channel][kind];
    console.log(`[MODELS] Resolved ${kind} in channel ${channel} -> ${config.provider}/${config.model}`);
    return config;
  }

  // Fall back to stable channel if not found
  if (channel !== 'stable' && catalog.channels.stable && catalog.channels.stable[kind]) {
    const config = catalog.channels.stable[kind];
    console.log(`[MODELS] Fallback: ${kind} not in ${channel}, using stable -> ${config.provider}/${config.model}`);
    return config;
  }

  // Model not found
  throw new Error(`Model kind "${kind}" not found in channel "${channel}" or stable fallback`);
}

export function getCatalog(): ModelCatalog {
  return loadCatalog();
}

// Clear cache (useful for hot-reloading during development)
export function clearCache(): void {
  catalogCache = null;
}
