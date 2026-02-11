import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../auth';
import { logger } from '../logger';
import {
  createSender,
  listSenders,
  getSender,
  updateSender,
  deleteSender,
  createMessage,
  listMessages,
  getMessage,
  updateMessage,
  getUnreadCount,
  getLatestMessagePerSender,
  registerDevice,
  unregisterDevice,
} from '../services/dispatch';
import { sendPushNotification } from '../services/apns';

const router = Router();

// ── Senders ────────────────────────────────────────────

// POST /v1/dispatch/senders - Register a sender
router.post('/senders', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id, name, subtitle, icon_url, accent_color, chat_enabled, reply_webhook } = req.body;

    if (!id || !name) {
      res.status(400).json({ error: 'id and name are required' });
      return;
    }

    const sender = await createSender({
      id, name, subtitle, icon_url, accent_color, chat_enabled, reply_webhook,
    });

    logger.info(`Sender registered: ${sender.id} (${sender.name})`);
    res.status(201).json(sender);
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ error: `Sender '${req.body.id}' already exists` });
      return;
    }
    logger.error('Create sender error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// GET /v1/dispatch/senders - List senders
router.get('/senders', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const senders = await listSenders();
    const includeLatest = req.query.include_latest === 'true';

    if (includeLatest) {
      const latest = await getLatestMessagePerSender();
      const enriched = senders.map((s) => ({
        ...s,
        latest_message: latest[s.id] || null,
      }));
      res.json(enriched);
      return;
    }

    res.json(senders);
  } catch (error: any) {
    logger.error('List senders error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// GET /v1/dispatch/senders/:id - Get sender
router.get('/senders/:id', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const sender = await getSender(req.params.id);
    if (!sender) {
      res.status(404).json({ error: 'Sender not found' });
      return;
    }
    res.json(sender);
  } catch (error: any) {
    logger.error('Get sender error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// PATCH /v1/dispatch/senders/:id - Update sender
router.patch('/senders/:id', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, subtitle, icon_url, accent_color, chat_enabled, reply_webhook } = req.body;
    const sender = await updateSender(req.params.id, {
      name, subtitle, icon_url, accent_color, chat_enabled, reply_webhook,
    });
    if (!sender) {
      res.status(404).json({ error: 'Sender not found' });
      return;
    }
    res.json(sender);
  } catch (error: any) {
    logger.error('Update sender error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// DELETE /v1/dispatch/senders/:id - Delete sender
router.delete('/senders/:id', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const deleted = await deleteSender(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Sender not found' });
      return;
    }
    res.status(204).send();
  } catch (error: any) {
    logger.error('Delete sender error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// ── Messages ───────────────────────────────────────────

// POST /v1/dispatch/messages - Send a message
router.post('/messages', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { sender_id, content, content_type, metadata, direction, in_reply_to } = req.body;

    if (!sender_id || !content) {
      res.status(400).json({ error: 'sender_id and content are required' });
      return;
    }

    // Verify sender exists
    const sender = await getSender(sender_id);
    if (!sender) {
      res.status(404).json({ error: `Sender '${sender_id}' not found` });
      return;
    }

    const message = await createMessage({
      sender_id, content, content_type, metadata, direction, in_reply_to,
    });

    logger.info(`Message ${message.id} from ${sender_id}`);

    // Fire push notification (non-blocking) for incoming messages
    if (message.direction === 'incoming') {
      const pushBody = content.length > 200 ? content.slice(0, 200) + '...' : content;
      sendPushNotification({
        title: sender.name,
        body: pushBody,
        senderId: sender_id,
        messageId: message.id,
      }).catch((err) => logger.error('Push fire-and-forget error:', err));
    }

    res.status(201).json(message);
  } catch (error: any) {
    logger.error('Create message error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// GET /v1/dispatch/messages - List messages
router.get('/messages', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { sender_id, direction, read, limit, before } = req.query;

    const messages = await listMessages({
      sender_id: sender_id as string,
      direction: direction as string,
      read: read !== undefined ? read === 'true' : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      before: before as string,
    });

    res.json(messages);
  } catch (error: any) {
    logger.error('List messages error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// GET /v1/dispatch/messages/unread-count - Get unread count
router.get('/messages/unread-count', (async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const count = await getUnreadCount();
    res.json({ unread_count: count });
  } catch (error: any) {
    logger.error('Unread count error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// GET /v1/dispatch/messages/:id - Get message
router.get('/messages/:id', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const message = await getMessage(req.params.id);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    res.json(message);
  } catch (error: any) {
    logger.error('Get message error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// PATCH /v1/dispatch/messages/:id - Update message (mark read)
router.patch('/messages/:id', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { read } = req.body;
    const message = await updateMessage(req.params.id, { read });
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    res.json(message);
  } catch (error: any) {
    logger.error('Update message error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// ── Devices ────────────────────────────────────────────

// POST /v1/dispatch/devices - Register device token
router.post('/devices', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { device_token } = req.body;
    if (!device_token) {
      res.status(400).json({ error: 'device_token is required' });
      return;
    }

    const device = await registerDevice(device_token);
    logger.info(`Device registered: ${device_token.slice(0, 8)}...`);
    res.status(201).json(device);
  } catch (error: any) {
    logger.error('Register device error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

// DELETE /v1/dispatch/devices/:token - Unregister device token
router.delete('/devices/:token', (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const removed = await unregisterDevice(req.params.token);
    if (!removed) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    res.status(204).send();
  } catch (error: any) {
    logger.error('Unregister device error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}) as any);

export default router;
