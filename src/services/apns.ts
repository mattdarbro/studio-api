import apn from '@parse/node-apn';
import { logger } from '../logger';
import { getAllDeviceTokens, getUnreadCount } from './dispatch';

let provider: apn.Provider | null = null;

function getProvider(): apn.Provider {
  if (provider) return provider;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;

  if (!keyId || !teamId) {
    throw new Error('APNS_KEY_ID and APNS_TEAM_ID must be set');
  }

  // Support base64-encoded key content (for Railway) or file path
  let key: string;
  if (process.env.APNS_KEY_CONTENT) {
    key = Buffer.from(process.env.APNS_KEY_CONTENT, 'base64').toString('utf8');
  } else if (process.env.APNS_KEY_PATH) {
    key = require('fs').readFileSync(process.env.APNS_KEY_PATH, 'utf8');
  } else {
    throw new Error('Either APNS_KEY_CONTENT or APNS_KEY_PATH must be set');
  }

  provider = new apn.Provider({
    token: { key, keyId, teamId },
    production: process.env.APNS_PRODUCTION !== 'false',
  });

  logger.info('APNs provider initialized');
  return provider;
}

export async function sendPushNotification(opts: {
  title: string;
  body: string;
  senderId: string;
  messageId: string;
}): Promise<void> {
  try {
    const tokens = await getAllDeviceTokens();
    if (tokens.length === 0) {
      logger.debug('No device tokens registered, skipping push');
      return;
    }

    const prov = getProvider();
    const bundleId = process.env.APNS_BUNDLE_ID || 'com.darbro.Dispatch';
    const badge = await getUnreadCount();

    const note = new apn.Notification();
    note.alert = { title: opts.title, body: opts.body };
    note.badge = badge;
    note.sound = 'default';
    note.topic = bundleId;
    note.threadId = opts.senderId;
    note.payload = {
      sender_id: opts.senderId,
      message_id: opts.messageId,
    };
    note.pushType = 'alert';

    const result = await prov.send(note, tokens);

    if (result.failed.length > 0) {
      logger.warn('APNs failures:', result.failed);
    }
    if (result.sent.length > 0) {
      logger.debug(`APNs sent to ${result.sent.length} device(s)`);
    }
  } catch (error) {
    logger.error('APNs send error:', error);
  }
}

export function shutdownApns(): void {
  if (provider) {
    provider.shutdown();
    provider = null;
    logger.info('APNs provider shut down');
  }
}
