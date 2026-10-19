import { describe, it, expect, beforeEach } from 'vitest';
import { useStrategyStore, createDefaultStrategy, createDefaultMtfStrategy } from './strategy';
import type { Strategy } from '@/types/strategy';

describe('Strategy Store — Group Actions & Scoping', () => {
  beforeEach(() => {
    const regularBtc1: Strategy = {
      ...createDefaultStrategy(),
      id: 'reg_btc_1',
      symbol: 'BTCUSDT',
      name: 'Regular BTC 1',
      isMtf: false,
      telegramTopic: undefined,
    };
    const regularBtc2: Strategy = {
      ...createDefaultStrategy(),
      id: 'reg_btc_2',
      symbol: 'BTCUSDT',
      name: 'Regular BTC 2',
      isMtf: false,
      telegramTopic: undefined,
    };
    const mtfBtc: Strategy = {
      ...createDefaultMtfStrategy(),
      id: 'mtf_btc_1',
      symbol: 'BTCUSDT',
      name: 'MTF BTC 1',
      isMtf: true,
      telegramTopic: { enabled: true, name: 'MTF_TOPIC' },
    };

    useStrategyStore.setState({
      strategies: [regularBtc1, regularBtc2, mtfBtc],
      activeStrategyId: null,
      backtestResult: null,
      isBacktesting: false,
      backtestHistory: {},
    });
  });

  it('sets group telegram topic only for regular strategies when isMtf is false', () => {
    const updated = useStrategyStore.getState().setGroupTelegramTopic(
      'BTCUSDT',
      { enabled: true, name: 'CRYPTO_BOT' },
      false,
    );

    expect(updated).toHaveLength(2);
    expect(updated.map((s) => s.id)).toEqual(['reg_btc_1', 'reg_btc_2']);

    const all = useStrategyStore.getState().strategies;
    const reg1 = all.find((s) => s.id === 'reg_btc_1');
    const reg2 = all.find((s) => s.id === 'reg_btc_2');
    const mtf = all.find((s) => s.id === 'mtf_btc_1');

    expect(reg1?.telegramTopic).toEqual({ enabled: true, name: 'CRYPTO_BOT' });
    expect(reg2?.telegramTopic).toEqual({ enabled: true, name: 'CRYPTO_BOT' });
    // MTF strategy topic must remain untouched
    expect(mtf?.telegramTopic).toEqual({ enabled: true, name: 'MTF_TOPIC' });
  });

  it('sets group telegram topic only for MTF strategies when isMtf is true', () => {
    const updated = useStrategyStore.getState().setGroupTelegramTopic(
      'BTCUSDT',
      { enabled: false, name: 'MTF_DISABLED' },
      true,
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe('mtf_btc_1');

    const all = useStrategyStore.getState().strategies;
    const reg1 = all.find((s) => s.id === 'reg_btc_1');
    const mtf = all.find((s) => s.id === 'mtf_btc_1');

    expect(mtf?.telegramTopic).toEqual({ enabled: false, name: 'MTF_DISABLED' });
    expect(reg1?.telegramTopic).toBeUndefined();
  });

  it('toggles group active state scoped to isMtf', () => {
    useStrategyStore.getState().setGroupActive('BTCUSDT', true, false);

    const all = useStrategyStore.getState().strategies;
    const reg1 = all.find((s) => s.id === 'reg_btc_1');
    const reg2 = all.find((s) => s.id === 'reg_btc_2');
    const mtf = all.find((s) => s.id === 'mtf_btc_1');

    expect(reg1?.isActive).toBe(true);
    expect(reg2?.isActive).toBe(true);
    expect(mtf?.isActive).toBe(false);
  });
});
