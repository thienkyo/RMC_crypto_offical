/**
 * GET /api/alerts/test
 *
 * Sends a hardcoded connectivity ping to Telegram.
 * Used by the "Test" button in AlertManager to verify bot token + chat ID
 * are working — independent of any alert rules or cooldowns.
 */

import { sendTelegramAlert, verifyTelegramConfig } from '@/lib/alerts/telegram';

export async function GET(): Promise<Response> {
  const verify = await verifyTelegramConfig();
  if (!verify.ok) {
    return Response.json({ ok: false, error: verify.error }, { status: 400 });
  }

  // Pass 'test' as targetName so this ping always routes to personal chat IDs.
  const result = await sendTelegramAlert(
    [
      '✅ <b>RMC Alerts connected</b>',
      `Bot: <code>@${verify.botName}</code>`,
      'Telegram delivery is working.',
      '<i>Paper trading only — not financial advice</i>',
    ].join('\n'),
    'test-connectivity-ping',
  );

  return Response.json(result);
}
