process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTelegramAlert, resolveStrategyTelegramTopic } from './telegram';
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

  it('topics SELECT throws -> logs warning, signal goes to main chat (no thread id)', async () => {
    (db.query as any).mockImplementation((queryText: string) => {
      const sql = queryText.toLowerCase();
      if (sql.includes('select key, value from settings')) {
        return Promise.resolve({ rows: [{ key: 'telegram_group_chat_id', value: '222' }] });
      }
      if (sql.includes('select message_thread_id from telegram_topics')) {
        return Promise.reject(new Error('DB Connection Lost'));
      }
      return Promise.resolve({ rows: [] });
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/sendMessage')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false };
    });

    const res = await sendTelegramAlert('test msg', 'strategy1', 'signal', { enabled: true, name: 'ERRUSDT' });
    
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    const sendCall = fetchMock.mock.calls[0];
    const sendBody = JSON.parse(sendCall[1].body);
    expect(sendBody.message_thread_id).toBeUndefined(); // Fallback to main chat
  });

  it('sends photo before sendMessage when image is provided', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/sendPhoto') || url.includes('/sendMessage')) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false };
    });

    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const res = await sendTelegramAlert(
      'Signal message text',
      'StrategyAlpha',
      'signal',
      { enabled: false, name: '' },
      { buffer: fakePng, caption: '<b>BTCUSDT</b> • LONG ▲' },
    );

    expect(res.ok).toBe(true);
    // Should call /sendPhoto and then /sendMessage
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/sendPhoto');
    expect(fetchMock.mock.calls[1][0]).toContain('/sendMessage');
  });
});

describe('resolveStrategyTelegramTopic', () => {
  it('uses symbol when enabled and name is empty/whitespace', () => {
    expect(resolveStrategyTelegramTopic({ enabled: true, name: '' }, 'BTCUSDT')).toEqual({ enabled: true, name: 'BTCUSDT' });
    expect(resolveStrategyTelegramTopic({ enabled: true, name: '   ' }, 'ETHUSDT')).toEqual({ enabled: true, name: 'ETHUSDT' });
  });

  it('keeps name when enabled and name is present', () => {
    expect(resolveStrategyTelegramTopic({ enabled: true, name: 'CustomTopic' }, 'BTCUSDT')).toEqual({ enabled: true, name: 'CustomTopic' });
  });

  it('stays off if disabled or undefined', () => {
    expect(resolveStrategyTelegramTopic(undefined, 'BTCUSDT')).toBeUndefined();
    expect(resolveStrategyTelegramTopic({ enabled: false, name: '' }, 'BTCUSDT')).toEqual({ enabled: false, name: '' });
  });
});

describe('formatMarketFlushMessage (Option E)', () => {
  it('formats a consolidated digest for multiple simultaneous signals with macro verdict', async () => {
    const { formatMarketFlushMessage } = await import('./telegram');
    const msg = formatMarketFlushMessage({
      signals: [
        { strategyName: 'L_BTC', symbol: 'BTCUSDT', timeframe: '4h', direction: 'long', entryPrice: 62000, rating: 5 },
        { strategyName: 'L_ETH', symbol: 'ETHUSDT', timeframe: '4h', direction: 'long', entryPrice: 2400, rating: 4 },
        { strategyName: 'S_PAXG', symbol: 'PAXGUSDT', timeframe: '4h', direction: 'short', entryPrice: 2650, rating: 4 },
      ],
      macroEvaluation: {
        verdict: 'CAVEAT',
        confidence: 'high',
        summary: 'Market-wide correlation flush following Bitcoin drop.',
        correlationContext: 'Altcoins showing high selling pressure.',
        keyRisks: ['Knife-catch hazard', 'Volatility expansion'],
        recommendedAction: 'Wait for 4h candle close before entering long.',
      },
      timestamp: 1770000000000,
    });

    expect(msg).toContain('MARKET FLUSH DETECTED (3 Signals Fired)');
    expect(msg).toContain('BTCUSDT');
    expect(msg).toContain('ETHUSDT');
    expect(msg).toContain('PAXGUSDT');
    expect(msg).toContain('CAVEAT');
    expect(msg).toContain('Wait for 4h candle close');
  });

  it('includes debug Ref IDs in strategy signal, alert, and market flush messages', async () => {
    const {
      formatStrategySignalMessage,
      formatAlertMessage,
      formatMarketFlushMessage,
    } = await import('./telegram');

    const sigMsg = formatStrategySignalMessage({
      strategyName:    'UTILMATE_L',
      rating:          5,
      symbol:          'BTCUSDT',
      timeframe:       '4h',
      direction:       'long',
      entryPrice:      67000,
      stopLossPct:     2,
      takeProfitPct:   5,
      conditionGroups: [],
      timestamp:       1770000000000,
      signalId:        482,
      strategyId:      'strategy_1747000111',
      strategyVersion: 3,
    });
    expect(sigMsg).toContain('sig#482');
    expect(sigMsg).toContain('strategy_1747000111 (v3)');

    const alertMsg = formatAlertMessage({
      symbol:         'BTCUSDT',
      timeframe:      '1h',
      indicatorName:  'RSI(14)',
      triggerDesc:    'RSI(14) below 30',
      currentValue:   28.4,
      price:          67000,
      timestamp:      1770000000000,
      ruleId:         'rule_abc_99',
      alertHistoryId: 84,
    });
    expect(alertMsg).toContain('alert#84');
    expect(alertMsg).toContain('rule:rule_abc_99');

    const flushMsg = formatMarketFlushMessage({
      signals: [
        {
          strategyName: 'L_BTC',
          symbol:       'BTCUSDT',
          timeframe:    '4h',
          direction:    'long',
          entryPrice:   62000,
          rating:       5,
          signalId:     501,
          strategyId:   'strategy_999',
        },
      ],
      macroEvaluation: {
        verdict:            'PASS',
        confidence:         'high',
        summary:            'Healthy pullback.',
        correlationContext: 'Aligned',
        keyRisks:           [],
        recommendedAction:  'Proceed',
      },
      timestamp: 1770000000000,
    });
    expect(flushMsg).toContain('sig#501');
    expect(flushMsg).toContain('strategy_999');
  });
});

