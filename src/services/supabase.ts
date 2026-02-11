import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });

  logger.info('Supabase client initialized');
  return client;
}
