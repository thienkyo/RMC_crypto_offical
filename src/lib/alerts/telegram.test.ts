process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTelegramAlert } from './telegram';
import { db } from '@/lib/db/client';

// We need to mock db.query to handle settings and telegram_topics.
vi.mock('@/lib/db/client', () => ({
  db: {
    query: vi.fn(),
  },
}));

describe('Telegram Alerts with Topics', () => {
  const originalFetch = global.fetch;
  let fetchMock: any;

  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Default db.query mock implementation for settings
    (db.query as any).mockImplementation((queryText: string, values?: any[]) => {
      const sql = queryText.toLowerCase();

      // Mock settings table for routing
      if (sql.includes('select key, value from settings')) {
        return Promise.resolve({
          rows: [
            { key: 'telegram_personal_chat_id', value: '111' },
            { key: 'telegram_group_chat_id', value: '222' },
            { key: 'telegram_alert_chat_id', value: '333' },
          ],
        });
      }

      // Default empty topics selection
      if (sql.includes('select message_thread_id from telegram_topics')) {
        return Promise.resolve({ rows: [] });
      }

      // Default successful insert
      if (sql.includes('insert into telegram_topics')) {
        return Promise.resolve({ rowCount: 1 });
      }

      // Default successful delete
      if (sql.includes('delete from telegram_topics')) {
        return Promise.resolve({ rowCount: 1 });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('resolve hits cache / existing row → no createForumTopic call', async () => {
    // Override db.query to return an existing thread_id for topics
    (db.query as any).mockImplementation((queryText: string, values?: any[]) => {
      const sql = queryText.toLowerCase();
      if (sql.includes('select key, value from settings')) {
        return Promise.resolve({ rows: [{ key: 'telegram_group_chat_id', value: '222' }] });
      }
      if (sql.includes('select message_thread_id from telegram_topics')) {
        return Promise.resolve({ rows: [{ message_thread_id: '42' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const res = await sendTelegramAlert('test message', 'strategy1', 'signal', { enabled: true, name: 'BTCUSDT' });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Only sendMessage, no createForumTopic
    
    const sendCall = fetchMock.mock.calls[0];
    expect(sendCall[0]).toContain('/sendMessage');
    const body = JSON.parse(sendCall[1].body);
    expect(body.message_thread_id).toBe(42);
  });

  it('missing → createForumTopic once, stores id, returns it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/createForumTopic')) {
        return {
          ok: true,
          json: async () => ({ result: { message_thread_id: 99 } }),
        };
      }
      if (url.includes('/sendMessage')) {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      }
      return { ok: false };
    });

    const res = await sendTelegramAlert('test message', 'strategy1', 'signal', { enabled: true, name: 'ETHUSDT' });
    
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // createForumTopic + sendMessage
    
    const createCall = fetchMock.mock.calls[0];
    expect(createCall[0]).toContain('/createForumTopic');
    const createBody = JSON.parse(createCall[1].body);
    expect(createBody.name).toBe('ETHUSDT');

    const sendCall = fetchMock.mock.calls[1];
    expect(sendCall[0]).toContain('/sendMessage');
    const sendBody = JSON.parse(sendCall[1].body);
    expect(sendBody.message_thread_id).toBe(99);

    // Verify insert was called
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO telegram_topics'),
      ['222', 'ETHUSDT', 99]
    );
  });

  it('race/conflict → re-select winner id', async () => {
    // 1. First SELECT returns empty
    // 2. INSERT returns 0 rows (conflict)
    // 3. Second SELECT returns the winner's id (88)
    let selectCallCount = 0;
    (db.query as any).mockImplementation((queryText: string, values?: any[]) => {
      const sql = queryText.toLowerCase();
      if (sql.includes('select key, value from settings')) {
        return Promise.resolve({ rows: [{ key: 'telegram_group_chat_id', value: '222' }] });
      }
      if (sql.includes('select message_thread_id from telegram_topics')) {
        selectCallCount++;
        if (selectCallCount === 1) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ message_thread_id: '88' }] });
      }
      if (sql.includes('insert into telegram_topics')) {
        return Promise.resolve({ rowCount: 0 }); // simulate conflict
      }
      return Promise.resolve({ rows: [] });
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/createForumTopic')) {
        return {
          ok: true,
          json: async () => ({ result: { message_thread_id: 100 } }), // our creation got 100
        };
      }
      if (url.includes('/sendMessage')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false };
    });

    const res = await sendTelegramAlert('test message', 'strategy1', 'signal', { enabled: true, name: 'XRPUSDT' });
    
    expect(res.ok).toBe(true);
    const sendCall = fetchMock.mock.calls.find((c: any) => c[0].includes('/sendMessage'));
    const sendBody = JSON.parse(sendCall[1].body);
    // It should use 88, not 100
    expect(sendBody.message_thread_id).toBe(88);
  });

  it('send/create failure → fallback main chat (warn path)', async () => {
    // createForumTopic fails
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/createForumTopic')) {
        return {
          ok: false,
          json: async () => ({ description: 'Forbidden: no rights to create topics' }),
        };
      }
      if (url.includes('/sendMessage')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false };
    });

    const res = await sendTelegramAlert('test message', 'strategy1', 'signal', { enabled: true, name: 'LTCUSDT' });
    
    expect(res.ok).toBe(true);
    const sendCall = fetchMock.mock.calls.find((c: any) => c[0].includes('/sendMessage'));
    const sendBody = JSON.parse(sendCall[1].body);
    // It should fall back to main chat (no message_thread_id)
    expect(sendBody.message_thread_id).toBeUndefined();
  });

  it('thread-not-found → deletes stale row and fallbacks to main chat', async () => {
    // 1. Topic is found in DB with id 77
    (db.query as any).mockImplementation((queryText: string, values?: any[]) => {
      const sql = queryText.toLowerCase();
      if (sql.includes('select key, value from settings')) {
        return Promise.resolve({ rows: [{ key: 'telegram_group_chat_id', value: '222' }] });
      }
      if (sql.includes('select message_thread_id from telegram_topics')) {
        return Promise.resolve({ rows: [{ message_thread_id: '77' }] });
      }
      if (sql.includes('delete from telegram_topics')) {
        return Promise.resolve({ rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });

    // 2. sendMessage fails with "message thread not found", retry succeeds
    let sendCallCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/sendMessage')) {
        sendCallCount++;
        if (sendCallCount === 1) {
          return {
            ok: false,
            json: async () => ({ description: 'Bad Request: message thread not found' }),
          };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false };
    });

    const res = await sendTelegramAlert('test message', 'strategy1', 'signal', { enabled: true, name: 'DOGEUSDT' });
    
    expect(res.ok).toBe(true);
    expect(sendCallCount).toBe(2);

    const firstSendCall = fetchMock.mock.calls[0];
    const firstSendBody = JSON.parse(firstSendCall[1].body);
    expect(firstSendBody.message_thread_id).toBe(77);

    const secondSendCall = fetchMock.mock.calls[1];
    const secondSendBody = JSON.parse(secondSendCall[1].body);
    expect(secondSendBody.message_thread_id).toBeUndefined(); // Fallback

    // Check that delete was called
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM telegram_topics'),
      ['222', 'DOGEUSDT']
    );
  });

  it('topic send fails with a non-thread error → still falls back to main chat (no message_thread_id on retry)', async () => {
    // 1. Topic is found in DB with id 88
    (db.query as any).mockImplementation((queryText: string, values?: any[]) => {
      const sql = queryText.toLowerCase();
      if (sql.includes('select key, value from settings')) {
        return Promise.resolve({ rows: [{ key: 'telegram_group_chat_id', value: '222' }] });
      }
      if (sql.includes('select message_thread_id from telegram_topics')) {
        return Promise.resolve({ rows: [{ message_thread_id: '88' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // 2. sendMessage fails with "TOPIC_CLOSED", retry succeeds without threadId
    let sendCallCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/sendMessage')) {
        sendCallCount++;
        if (sendCallCount === 1) {
          return {
            ok: false,
            json: async () => ({ description: 'Bad Request: TOPIC_CLOSED' }),
          };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false };
    });

    const res = await sendTelegramAlert('test message', 'strategy1', 'signal', { enabled: true, name: 'SOLUSDT' });
    
    expect(res.ok).toBe(true);
    expect(sendCallCount).toBe(2);

    const firstSendCall = fetchMock.mock.calls[0];
    const firstSendBody = JSON.parse(firstSendCall[1].body);
    expect(firstSendBody.message_thread_id).toBe(88);

    const secondSendCall = fetchMock.mock.calls[1];
    const secondSendBody = JSON.parse(secondSendCall[1].body);
    expect(secondSendBody.message_thread_id).toBeUndefined(); // Fallback

    // Check that delete was NOT called
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM telegram_topics'),
      expect.anything()
    );
  });
});
