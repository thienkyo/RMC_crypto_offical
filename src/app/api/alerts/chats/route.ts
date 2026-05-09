/**
 * GET /api/alerts/chats
 *
 * Discovery helper — calls Telegram getUpdates and returns every unique chat
 * the bot has seen (personal chats, groups, supergroups).
 *
 * Usage:
 *   1. Add the bot to your group and send at least one message in that group.
 *   2. Call GET /api/alerts/chats (open in browser or hit the button in AlertManager).
 *   3. Copy the chat_id values you want.
 *   4. Set TELEGRAM_CHAT_ID=<personal_id>,<group_id> in .env.local.
 *
 * Note: getUpdates only returns updates from the past ~24 h that haven't been
 * consumed yet by a long-polling listener.  If the bot is also receiving
 * messages via a webhook this endpoint will return no updates (Telegram
 * disallows mixing the two modes).
 */

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: {
      id:         number;
      type:       string;
      title?:     string;
      username?:  string;
      first_name?: string;
      last_name?:  string;
    };
  };
  channel_post?: {
    chat: {
      id:    number;
      type:  string;
      title?: string;
    };
  };
}

interface ChatSummary {
  id:    number;
  type:  string;
  name:  string;
}

export async function GET(): Promise<Response> {
  if (!BOT_TOKEN) {
    return Response.json(
      { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${BOT_TOKEN}/getUpdates?limit=100`,
    );

    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
      const error   = (payload['description'] as string | undefined) ?? `HTTP ${res.status}`;
      return Response.json({ ok: false, error }, { status: 502 });
    }

    const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };

    if (!data.ok) {
      return Response.json({ ok: false, error: 'Telegram returned ok:false' }, { status: 502 });
    }

    // Collect unique chats across messages and channel posts.
    const seen = new Map<number, ChatSummary>();

    for (const update of data.result) {
      const msgChat  = update.message?.chat;
      const postChat = update.channel_post?.chat;
      const chat     = msgChat ?? postChat;
      if (!chat) continue;

      if (!seen.has(chat.id)) {
        // Personal chats (type === 'private') have first_name/last_name/username
        // but not title.  Groups/supergroups/channels have title.
        let name: string;
        if (msgChat && msgChat.type === 'private') {
          const parts = [msgChat.first_name, msgChat.last_name].filter(Boolean).join(' ');
          name = (parts.length > 0 ? parts : null) ?? (msgChat.username ?? String(chat.id));
        } else {
          name = chat.title ?? String(chat.id);
        }

        seen.set(chat.id, { id: chat.id, type: chat.type, name });
      }
    }

    const chats = Array.from(seen.values()).sort((a, b) => {
      // Personal chats first (positive IDs), then groups (negative).
      if (a.id > 0 && b.id < 0) return -1;
      if (a.id < 0 && b.id > 0) return  1;
      return a.name.localeCompare(b.name);
    });

    return Response.json({ ok: true, chats });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
