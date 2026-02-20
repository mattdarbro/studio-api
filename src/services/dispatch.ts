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
  channel_id: string | null;
  created_at: string;
}

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  auto_created: boolean;
  created_at: string;
}

export interface ChannelSubscription {
  id: string;
  channel_id: string;
  sender_id: string;
  webhook_url: string | null;
  subscribed_at: string;
}

export interface AgentRegistration {
  id: string;
  name: string;
  role?: string;
  owner_app?: string;
  capabilities?: string[];
  trust_level?: number;
  accent_color?: string;
  icon_url?: string;
  reply_webhook?: string;
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

export async function upsertSender(data: {
  id: string;
  name: string;
  subtitle?: string;
  icon_url?: string;
  accent_color?: string;
  chat_enabled?: boolean;
  reply_webhook?: string;
}): Promise<Sender> {
  const sb = getSupabase();
  const cleaned = Object.fromEntries(
    Object.entries(data).filter(([_, v]) => v !== undefined)
  );
  const { data: sender, error } = await sb
    .from('dispatch_senders')
    .upsert(cleaned, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return sender;
}

// ── Channels ──────────────────────────────────────────

export async function createChannel(data: {
  id: string;
  name: string;
  description?: string;
  created_by?: string;
}): Promise<Channel> {
  const sb = getSupabase();
  const { data: channel, error } = await sb
    .from('dispatch_channels')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return channel;
}

export async function listChannels(): Promise<Channel[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_channels')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getChannel(id: string): Promise<Channel | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_channels')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function deleteChannel(id: string): Promise<boolean> {
  const sb = getSupabase();
  const { error, count } = await sb
    .from('dispatch_channels')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function subscribe(
  channel_id: string,
  sender_id: string,
  webhook_url?: string
): Promise<ChannelSubscription> {
  const sb = getSupabase();
  const insert: Record<string, any> = { channel_id, sender_id };
  if (webhook_url !== undefined) insert.webhook_url = webhook_url;
  const { data, error } = await sb
    .from('dispatch_channel_subscriptions')
    .insert(insert)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function unsubscribe(
  channel_id: string,
  sender_id: string
): Promise<boolean> {
  const sb = getSupabase();
  const { error, count } = await sb
    .from('dispatch_channel_subscriptions')
    .delete({ count: 'exact' })
    .eq('channel_id', channel_id)
    .eq('sender_id', sender_id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function listSubscriptions(
  channel_id: string
): Promise<ChannelSubscription[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_channel_subscriptions')
    .select('*')
    .eq('channel_id', channel_id)
    .order('subscribed_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getSubscribersWithWebhooks(
  channel_id: string
): Promise<ChannelSubscription[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_channel_subscriptions')
    .select('*')
    .eq('channel_id', channel_id)
    .not('webhook_url', 'is', null);
  if (error) throw error;
  return data;
}

export async function isSubscribed(
  channel_id: string,
  sender_id: string
): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dispatch_channel_subscriptions')
    .select('id')
    .eq('channel_id', channel_id)
    .eq('sender_id', sender_id)
    .single();
  if (error && error.code === 'PGRST116') return false;
  if (error) throw error;
  return !!data;
}

// ── Agent-to-Agent Routing ────────────────────────────

export async function resolveTargets(
  senderId: string,
  content: string,
  targetSenderId?: string
): Promise<string[]> {
  const targets = new Set<string>();

  // Explicit target
  if (targetSenderId && targetSenderId !== senderId) {
    const sender = await getSender(targetSenderId);
    if (sender) targets.add(targetSenderId);
  }

  // @mention parsing
  const mentions = content.match(/@([a-zA-Z0-9_-]+)/g);
  if (mentions) {
    for (const mention of mentions) {
      const id = mention.slice(1);
      if (id !== senderId) {
        const sender = await getSender(id);
        if (sender) targets.add(id);
      }
    }
  }

  return Array.from(targets);
}

export async function getOrCreateAgentChannel(
  senderA: Sender,
  senderB: Sender
): Promise<Channel> {
  const ids = [senderA.id, senderB.id].sort();
  const channelId = `agent_${ids.join('__')}`;

  const existing = await getChannel(channelId);
  if (existing) return existing;

  const channel = await createChannel({
    id: channelId,
    name: `${senderA.name} ↔ ${senderB.name}`,
    description: 'Auto-created agent conversation',
    created_by: senderA.id,
  });

  // Mark as auto-created
  const sb = getSupabase();
  await sb.from('dispatch_channels').update({ auto_created: true }).eq('id', channelId);

  // Subscribe both with their webhooks
  await subscribe(channelId, senderA.id, senderA.reply_webhook ?? undefined);
  await subscribe(channelId, senderB.id, senderB.reply_webhook ?? undefined);

  return channel;
}

export async function getThreadContext(
  channelId: string,
  limit: number = 10
): Promise<{ participants: string[]; recent_messages: any[] }> {
  const subs = await listSubscriptions(channelId);
  const messages = await listMessages({ channel_id: channelId, limit });

  return {
    participants: subs.map(s => s.sender_id),
    recent_messages: messages.reverse().map(m => ({
      sender_id: m.sender_id,
      content: m.content,
      created_at: m.created_at,
    })),
  };
}

export async function fireWebhooks(
  channel_id: string,
  message: Message,
  sender: Sender
): Promise<void> {
  const subs = await getSubscribersWithWebhooks(channel_id);
  const threadContext = await getThreadContext(channel_id);

  const payload = {
    event: 'message.created',
    channel_id,
    message: { id: message.id, sender_id: message.sender_id, content: message.content, channel_id: message.channel_id, created_at: message.created_at },
    sender: { id: sender.id, name: sender.name, accent_color: sender.accent_color },
    thread: threadContext,
  };

  for (const sub of subs) {
    if (sub.sender_id === message.sender_id) continue; // don't webhook yourself
    if (!sub.webhook_url) continue;
    fetch(sub.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => logger.warn(`Webhook delivery failed for ${sub.sender_id}:`, err));
  }
}

// ── Agent Registration ────────────────────────────────

export async function registerAgent(data: AgentRegistration): Promise<{
  sender: Sender;
  profile_created: boolean;
}> {
  const sender = await upsertSender({
    id: data.id,
    name: data.name,
    accent_color: data.accent_color,
    icon_url: data.icon_url,
    reply_webhook: data.reply_webhook,
    chat_enabled: true,
  });

  let profile_created = false;
  const lsUrl = process.env.LOOP_SYMPHONY_URL;
  if (lsUrl) {
    try {
      await fetch(`${lsUrl}/knowledge/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          role: data.role,
          owner_app: data.owner_app,
          capabilities: data.capabilities,
          trust_level: data.trust_level,
        }),
      });
      profile_created = true;
    } catch (err) {
      logger.warn('Loop Symphony notification failed:', err);
    }
  }

  return { sender, profile_created };
}

// ── Messages ───────────────────────────────────────────

export async function createMessage(data: {
  sender_id: string;
  content: string;
  content_type?: string;
  metadata?: Record<string, any>;
  direction?: 'incoming' | 'outgoing';
  in_reply_to?: string;
  channel_id?: string;
}): Promise<Message> {
  const sb = getSupabase();
  // Filter out undefined values to let DB defaults apply
  const cleaned = Object.fromEntries(
    Object.entries(data).filter(([_, v]) => v !== undefined)
  );
  const { data: message, error } = await sb
    .from('dispatch_messages')
    .insert({ id: generateMessageId(), ...cleaned })
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
  channel_id?: string;
}): Promise<Message[]> {
  const sb = getSupabase();
  let query = sb
    .from('dispatch_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 50);

  if (filters.channel_id) query = query.eq('channel_id', filters.channel_id);
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

export async function deleteMessagesForSender(senderId: string): Promise<number> {
  const sb = getSupabase();
  const { error, count } = await sb
    .from('dispatch_messages')
    .delete({ count: 'exact' })
    .eq('sender_id', senderId);
  if (error) throw error;
  return count ?? 0;
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
