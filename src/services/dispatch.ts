import crypto from 'crypto';
import { getSupabase } from './supabase';
import { logger } from '../logger';

// ── Types ──────────────────────────────────────────────

export interface Sender {
  id: string;
  name: string;
  subtitle: string | null;
  icon_url: string | null;
  accent_color: string;
  chat_enabled: boolean;
  reply_webhook: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  content: string;
  content_type: string;
  metadata: Record<string, any>;
  direction: 'incoming' | 'outgoing';
  read: boolean;
  in_reply_to: string | null;
  created_at: string;
}

export interface Device {
  id: string;
  device_token: string;
  created_at: string;
}

// ── ID Generation ──────────────────────────────────────

function generateMessageId(): string {
  return 'msg_' + crypto.randomBytes(12).toString('base64url');
}

// ── Senders ────────────────────────────────────────────

export async function createSender(data: {
  id: string;
  name: string;
  subtitle?: string;
  icon_url?: string;
  accent_color?: string;
  chat_enabled?: boolean;
  reply_webhook?: string;
}): Promise<Sender> {
  const sb = getSupabase();
  const { data: sender, error } = await sb
    .from('dispatch_senders')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return sender;
}

export async function listSenders(): Promise<Sender[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_senders')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getSender(id: string): Promise<Sender | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_senders')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function updateSender(
  id: string,
  updates: Partial<Omit<Sender, 'id' | 'created_at'>>
): Promise<Sender | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_senders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function deleteSender(id: string): Promise<boolean> {
  const sb = getSupabase();
  const { error, count } = await sb
    .from('dispatch_senders')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// ── Messages ───────────────────────────────────────────

export async function createMessage(data: {
  sender_id: string;
  content: string;
  content_type?: string;
  metadata?: Record<string, any>;
  direction?: 'incoming' | 'outgoing';
  in_reply_to?: string;
}): Promise<Message> {
  const sb = getSupabase();
  const { data: message, error } = await sb
    .from('dispatch_messages')
    .insert({ id: generateMessageId(), ...data })
    .select()
    .single();
  if (error) throw error;
  return message;
}

export async function listMessages(filters: {
  sender_id?: string;
  direction?: string;
  read?: boolean;
  limit?: number;
  before?: string;
}): Promise<Message[]> {
  const sb = getSupabase();
  let query = sb
    .from('dispatch_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 50);

  if (filters.sender_id) query = query.eq('sender_id', filters.sender_id);
  if (filters.direction) query = query.eq('direction', filters.direction);
  if (filters.read !== undefined) query = query.eq('read', filters.read);
  if (filters.before) query = query.lt('created_at', filters.before);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getMessage(id: string): Promise<Message | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_messages')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function updateMessage(
  id: string,
  updates: Partial<Pick<Message, 'read'>>
): Promise<Message | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_messages')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function getUnreadCount(): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb
    .from('dispatch_messages')
    .select('*', { count: 'exact', head: true })
    .eq('read', false)
    .eq('direction', 'incoming');
  if (error) throw error;
  return count ?? 0;
}

export async function getLatestMessagePerSender(): Promise<
  Record<string, Message>
> {
  const sb = getSupabase();
  // Get all senders then fetch latest message for each
  const { data: senders, error: sErr } = await sb
    .from('dispatch_senders')
    .select('id');
  if (sErr) throw sErr;

  const result: Record<string, Message> = {};
  await Promise.all(
    (senders ?? []).map(async (s) => {
      const { data, error } = await sb
        .from('dispatch_messages')
        .select('*')
        .eq('sender_id', s.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (!error && data) result[s.id] = data;
    })
  );
  return result;
}

// ── Devices ────────────────────────────────────────────

export async function registerDevice(
  deviceToken: string
): Promise<Device> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_devices')
    .upsert({ device_token: deviceToken }, { onConflict: 'device_token' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function unregisterDevice(deviceToken: string): Promise<boolean> {
  const sb = getSupabase();
  const { error, count } = await sb
    .from('dispatch_devices')
    .delete({ count: 'exact' })
    .eq('device_token', deviceToken);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getAllDeviceTokens(): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_devices')
    .select('device_token');
  if (error) throw error;
  return (data ?? []).map((d) => d.device_token);
}
