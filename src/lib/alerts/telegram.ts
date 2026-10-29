/**
 * Telegram bot client for RMC alert delivery.
 *
 * Required env var (server-side only):
 *   TELEGRAM_BOT_TOKEN   — from @BotFather (/newbot)
 *
 * Chat IDs are stored in the `settings` DB table and managed via the Settings
 * page — no redeploy needed when you change them.
 *
 * Routing rule:
 *   alert/strategy name contains "test" (case-insensitive)
 *     → personal chat IDs  (visible only to you)
 *   otherwise
 *     → group chat IDs     (broadcast to group/channel)
 */

import { db } from '@/lib/db/client';
import { parseChatIds, isTestTarget } from '@/lib/telegram';
import { escapeHtml as esc } from '@/lib/format';
import {
  formatAlertMessage,
  formatStrategySignalMessage,
  formatAiEvaluationMessage,
  formatMarketFlushMessage,
  type ConditionGroupDisplay,
} from './telegramFormatters';
import type { OrderEvaluationResult } from '@/lib/ai/evaluator/types';
import type { ChartAnalysis } from '@/lib/ai/types';
import type { DynamicAtrLevels } from '@/types/strategy';
export { strategyRating } from '@/lib/strategy/rating';
export type { DynamicAtrLevels, ConditionGroupDisplay };
export {
  formatAlertMessage,
  formatStrategySignalMessage,
  formatAiEvaluationMessage,
  formatMarketFlushMessage,
};

const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramSendResult {
  ok: boolean;
  /** Number of chats successfully delivered to. */
  delivered?: number;
  /** First error encountered, if any. */
  error?: string;
  /** Primary Telegram message ID if available. */
  messageId?: number;
  /** Map of chatId to message_id. */
  chatMessageIds?: Record<string, number>;
}

/**
 * Send an HTML-mode message, routing to personal or group chat IDs based on
 * `targetName` (alert rule name or strategy name).
 *
 * - Name contains "test" (case-insensitive) → personal chat IDs
 * - Otherwise → group chat IDs
 *
 * Returns ok:true as long as at least one delivery succeeded. Never throws.
 */
export interface TelegramAlertImage {
  buffer: Buffer;
  caption?: string;
}

/**
 * Checks whether chart images should be attached to strategy signals.
 * Priority: DB setting `telegram_send_signal_chart` > default (true).
 */
export async function isSignalChartEnabled(): Promise<boolean> {
  try {
    const { rows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = 'telegram_send_signal_chart' LIMIT 1`,
    );
    if (rows[0]?.value !== undefined && rows[0]?.value !== null) {
      const val = rows[0].value.trim().toLowerCase();
      return val === 'true' || val === '1';
    }
  } catch (err) {
    console.warn('[telegram] Failed to read telegram_send_signal_chart setting:', err);
  }
  return true; // Default is ON
}

/**
 * Send an HTML-mode message, routing to the appropriate chat IDs.
 *
 * Routing priority (highest first):
 *   1. Name contains "test" (case-insensitive) → Test chat IDs
 *   2. channel === 'alert'                     → Alert chat IDs
 *   3. channel === 'signal' (default)          → Signal chat IDs
 *
 * Returns ok:true as long as at least one delivery succeeded. Never throws.
 */
export async function sendTelegramAlert(
  text:               string,
  targetName:         string,
  channel:            'signal' | 'alert' = 'signal',
  topic?:             { enabled: boolean; name: string },
  image?:             TelegramAlertImage,
  replyToMessageId?:  number,
): Promise<TelegramSendResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set in .env.local' };
  }

  // ── Load chat IDs from DB ─────────────────────────────────────────────────
  let testIds:   string[] = [];
  let signalIds: string[] = [];
  let alertIds:  string[] = [];
  try {
    const { rows } = await db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM settings
       WHERE key IN ('telegram_personal_chat_id', 'telegram_group_chat_id', 'telegram_alert_chat_id')`,
    );
    const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    testIds    = parseChatIds(map['telegram_personal_chat_id']);
    signalIds  = parseChatIds(map['telegram_group_chat_id']);
    alertIds   = parseChatIds(map['telegram_alert_chat_id']);
  } catch (err) {
    return { ok: false, error: `Failed to load chat IDs from DB: ${String(err)}` };
  }

  // ── Route ─────────────────────────────────────────────────────────────────
  const isTest = isTestTarget(targetName);
  let chatIds: string[];
  let channelLabel: string;

  if (isTest) {
    chatIds      = testIds;
    channelLabel = 'test';
  } else if (channel === 'alert') {
    chatIds      = alertIds;
    channelLabel = 'alert';
  } else {
    chatIds      = signalIds;
    channelLabel = 'signal';
  }

  if (chatIds.length === 0) {
    const msg = `No ${channelLabel} chat IDs configured — add them on the Settings page`;
    console.warn(`[telegram] ${msg} (target: "${targetName}")`);
    return { ok: false, error: msg };
  }

  console.log(
    `[telegram] "${targetName}" → ${channelLabel} (${chatIds.length} chat(s), isTest=${isTest})`,
  );

  // ── Send in parallel ──────────────────────────────────────────────────────
  let delivered  = 0;
  let firstError: string | undefined;
  let primaryMessageId: number | undefined;
  const chatMessageIds: Record<string, number> = {};

  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        let threadId: number | undefined;
        const finalTopicName = topic?.enabled ? topic.name.trim() : '';

        if (finalTopicName) {
          threadId = await resolveTopicThreadId(chatId, finalTopicName);
        }

        // If image is present, send photo first
        if (image?.buffer) {
          try {
            const formData = new FormData();
            formData.append('chat_id', chatId);
            if (threadId) formData.append('message_thread_id', String(threadId));
            if (replyToMessageId) {
              formData.append('reply_parameters', JSON.stringify({ message_id: replyToMessageId }));
              formData.append('reply_to_message_id', String(replyToMessageId));
            }
            formData.append(
              'photo',
              new Blob([new Uint8Array(image.buffer)], { type: 'image/png' }),
              'signal_chart.png',
            );
            if (image.caption) {
              formData.append('caption', image.caption);
              formData.append('parse_mode', 'HTML');
            }

            let photoRes = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
              method: 'POST',
              body: formData,
            });

            if (!photoRes.ok && threadId) {
              // Retry without threadId if topic wasn't found
              formData.delete('message_thread_id');
              photoRes = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
                method: 'POST',
                body: formData,
              });
            }

            if (photoRes.ok) {
              const photoPayload = await photoRes.json().catch(() => ({})) as { result?: { message_id?: number } };
              const pMsgId = photoPayload.result?.message_id;
              if (pMsgId) {
                chatMessageIds[chatId] = pMsgId;
                primaryMessageId ??= pMsgId;
              }
            }
          } catch (photoErr) {
            console.warn('[telegram] Signal photo send exception:', photoErr);
          }
        }

        const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
        if (threadId) {
          body.message_thread_id = threadId;
        }
        if (replyToMessageId) {
          body.reply_parameters = { message_id: replyToMessageId };
          body.reply_to_message_id = replyToMessageId;
        }

        let res = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        });

        if (!res.ok) {
          let payload = await res.json().catch(() => ({})) as Record<string, unknown>;
          let errMsg  = (payload['description'] as string | undefined) ?? `HTTP ${res.status}`;
          
          if (threadId) {
            console.warn(`[telegram] Topic send failed for topic "${finalTopicName}" in chat ${chatId}: ${errMsg}. Falling back to main chat.`);
            if (errMsg.match(/thread not found|topic not found|topic deleted|message thread not found/i)) {
              console.warn(`[telegram] Thread not found, deleting stale DB row.`);
              try {
                await db.query(`DELETE FROM telegram_topics WHERE chat_id = $1 AND lower(name) = lower($2)`, [chatId, finalTopicName]);
              } catch (delErr) {
                console.warn(`[telegram] Failed to delete stale topic row: ${delErr}`);
              }
            }
            
            delete body.message_thread_id;
            res = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(body),
            });
            if (!res.ok) {
              payload = await res.json().catch(() => ({})) as Record<string, unknown>;
              errMsg  = (payload['description'] as string | undefined) ?? `HTTP ${res.status}`;
            }
          }
          
          if (!res.ok) {
            console.error(`[telegram] Failed to deliver to ${chatId}: ${errMsg}`);
            firstError ??= `chat ${chatId}: ${errMsg}`;
          } else {
            delivered++;
            const okPayload = await res.json().catch(() => ({})) as { result?: { message_id?: number } };
            const mId = okPayload.result?.message_id;
            if (mId) {
              chatMessageIds[chatId] = mId;
              primaryMessageId ??= mId;
            }
          }
        } else {
          delivered++;
          const okPayload = await res.json().catch(() => ({})) as { result?: { message_id?: number } };
          const mId = okPayload.result?.message_id;
          if (mId) {
            chatMessageIds[chatId] = mId;
            primaryMessageId ??= mId;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[telegram] Exception delivering to ${chatId}: ${errMsg}`);
        firstError ??= `chat ${chatId}: ${errMsg}`;
      }
    }),
  );

  return delivered > 0
    ? { ok: true, delivered, messageId: primaryMessageId, chatMessageIds }
    : { ok: false, error: firstError ?? 'All deliveries failed', delivered: 0 };
}


async function resolveTopicThreadId(chatId: string, topicName: string): Promise<number | undefined> {
  if (!topicName) return undefined;
  
  try {
    const { rows } = await db.query<{ message_thread_id: string }>(
      `SELECT message_thread_id FROM telegram_topics
       WHERE chat_id = $1 AND lower(name) = lower($2)`,
      [chatId, topicName]
    );
    if (rows.length > 0) {
      return parseInt(rows[0]!.message_thread_id, 10);
    }

    if (!process.env.TELEGRAM_BOT_TOKEN) return undefined;
    const res = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, name: topicName }),
    });
    
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
      console.warn(`[telegram] Failed to create topic "${topicName}" in chat ${chatId}: ${payload['description']}`);
      return undefined;
    }
    
    const payload = await res.json() as { result: { message_thread_id: number } };
    const threadId = payload.result.message_thread_id;
    
    const insertRes = await db.query(
      `INSERT INTO telegram_topics (chat_id, name, message_thread_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (chat_id, (lower(name))) DO NOTHING`,
       [chatId, topicName, threadId]
    );
    
    if (insertRes.rowCount === 0) {
      const { rows: winnerRows } = await db.query<{ message_thread_id: string }>(
        `SELECT message_thread_id FROM telegram_topics
         WHERE chat_id = $1 AND lower(name) = lower($2)`,
        [chatId, topicName]
      );
      if (winnerRows.length > 0) {
        return parseInt(winnerRows[0]!.message_thread_id, 10);
      }
    }
    
    return threadId;
  } catch (err) {
    console.warn(`[telegram] Error looking up/creating topic "${topicName}": ${err}`);
    return undefined;
  }
}

/**
 * Resolves the strategy telegram topic. If enabled but name is empty, defaults to symbol.
 * If a common strategy has a topic name that points to one of the other monitored symbols,
 * it routes to the active firing symbol.
 */
export function resolveStrategyTelegramTopic(
  topic: { enabled: boolean; name: string } | undefined,
  symbol: string,
  isCommon?: boolean,
  allSymbols?: string[],
): { enabled: boolean; name: string } | undefined {
  if (!topic) return undefined;
  if (!topic.enabled) return topic;
  const trimmed = topic.name?.trim() || '';
  if (!trimmed || trimmed === '{symbol}') {
    return { enabled: true, name: symbol };
  }
  if (isCommon && allSymbols && allSymbols.length > 1 && allSymbols.includes(trimmed) && trimmed !== symbol) {
    return { enabled: true, name: symbol };
  }
  const resolvedName = trimmed.replace(/{symbol}/gi, symbol);
  return { enabled: true, name: resolvedName || symbol };
}

// ─── Bot utilities ────────────────────────────────────────────────────────────

/**
 * Verify bot credentials by calling getMe.
 * Used by the /api/alerts/test endpoint.
 */
export async function verifyTelegramConfig(): Promise<{ ok: boolean; botName?: string; error?: string }> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
  try {
    const res  = await fetch(`${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (!data.ok) return { ok: false, error: 'Invalid bot token' };
    return { ok: true, botName: data.result?.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── AI Evaluation Message Delivery ───────────────────────────────────────────

export interface SendAiEvaluationOptions {
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  evaluation: OrderEvaluationResult;
  vision?: ChartAnalysis;
  imageBase64?: string;
  channel?: 'signal' | 'personal' | 'alert';
  topic?: { enabled: boolean; name?: string };
}

/**
 * Sends the AI evaluation report (and optional canvas screenshot) to the Telegram group.
 */
export async function sendAiEvaluationToTelegram(
  opts: SendAiEvaluationOptions
): Promise<TelegramSendResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set in .env.local' };
  }

  // Load chat IDs from settings table in DB
  const { rows } = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM settings
     WHERE key IN ('telegram_personal_chat_id', 'telegram_group_chat_id', 'telegram_alert_chat_id')`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const channel = opts.channel ?? 'signal';
  const chatIds =
    channel === 'personal'
      ? parseChatIds(map['telegram_personal_chat_id'])
      : channel === 'alert'
      ? parseChatIds(map['telegram_alert_chat_id'])
      : parseChatIds(map['telegram_group_chat_id']);

  if (chatIds.length === 0) {
    const channelName = channel === 'signal' ? 'group' : channel;
    return {
      ok: false,
      error: `No Telegram ${channelName} chat IDs configured. Please set them in Settings.`,
    };
  }

  const messageText = formatAiEvaluationMessage(opts);
  let delivered = 0;
  let firstError: string | undefined;

  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        let threadId: number | undefined;
        try {
          const isTopicEnabled = opts.topic ? opts.topic.enabled : true;
          const topicName = opts.topic?.name?.trim() || opts.symbol;
          if (isTopicEnabled && topicName) {
            threadId = await resolveTopicThreadId(chatId, topicName);
          }
        } catch {
          // ignore topic error, fallback to general chat
        }

        // If screenshot is present, send chart photo first
        if (opts.imageBase64) {
          try {
            const base64Data = opts.imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const formData = new FormData();
            formData.append('chat_id', chatId);
            if (threadId) formData.append('message_thread_id', String(threadId));
            formData.append('photo', new Blob([buffer], { type: 'image/png' }), 'chart.png');
            formData.append(
              'caption',
              `📊 <b>${esc(opts.symbol)} (${esc(opts.timeframe.toUpperCase())})</b> • AI Vision Chart`,
            );
            formData.append('parse_mode', 'HTML');

            let photoRes = await fetch(`${TELEGRAM_API}/bot${botToken}/sendPhoto`, {
              method: 'POST',
              body: formData,
            });

            if (!photoRes.ok && threadId) {
              // Retry without threadId if topic wasn't found
              formData.delete('message_thread_id');
              await fetch(`${TELEGRAM_API}/bot${botToken}/sendPhoto`, {
                method: 'POST',
                body: formData,
              });
            }
          } catch (photoErr) {
            console.warn('[telegram] Photo send exception:', photoErr);
          }
        }

        // Send formatted HTML evaluation message
        const body: Record<string, unknown> = {
          chat_id: chatId,
          text: messageText,
          parse_mode: 'HTML',
        };
        if (threadId) body.message_thread_id = threadId;

        let res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          if (threadId) {
            delete body.message_thread_id;
            res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
          }

          if (!res.ok) {
            const errPayload = await res.json().catch(() => ({})) as Record<string, unknown>;
            const errMsg = (errPayload['description'] as string) || `HTTP ${res.status}`;
            firstError ??= errMsg;
          } else {
            delivered++;
          }
        } else {
          delivered++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        firstError ??= errMsg;
      }
    }),
  );

  return delivered > 0
    ? { ok: true, delivered }
    : { ok: false, error: firstError ?? 'Failed to send message to Telegram' };
}


