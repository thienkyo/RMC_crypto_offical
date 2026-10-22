/**
 * Automated signal forward-tester & performance resolver.
 *
 * Checks strategy signals against subsequent market candles to determine
 * whether Take Profit (TP) or Stop Loss (SL) was triggered first, and
 * updates actual_entry_price, actual_exit_price, pnl_pct, outcome_note,
 * and outcome_at.
 */

import { db } from '@/lib/db/client';
import { fetchKlines, TF_TO_MS } from '@/lib/exchange/binance';
import { computeEntryPriceLimit, DEFAULT_ENTRY_OFFSET } from '@/lib/strategy/entryPrice';
import type { Timeframe, Candle } from '@/types/market';

export interface SignalResolution {
  resolved: boolean;
  expired?: boolean;
  actualEntryPrice?: number;
  actualExitPrice?: number;
  pnlPct?: number;
  outcomeAt?: number;
  outcomeNote?: string;
}

export interface EvaluationOptions {
  /**
   * 'market' enters immediately at signal.entry_price on signal candle close.
   * 'limit' waits up to maxWaitBars for price to pull back to entry_price_limit (or default 2% offset).
   */
  entryMode?: 'market' | 'limit';
  /** Max bars to wait for a limit order to fill before expiring. Default: 6. */
  maxWaitBars?: number;
  /**
   * Move stop-loss to a small profit lock (+0.15R) once trade reaches +1R in favor.
   * Default: false in bare unit calls, true in resolveSignals.
   */
  breakevenAt1R?: boolean;
}

export interface CandidateSignal {
  id: number;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entry_price: number;
  entry_price_limit?: number | null;
  stop_loss_pct: number;
  take_profit_pct: number;
  candle_time: number;
  pnl_pct: number | null;
  outcome_note: string | null;
}

/**
 * Pure evaluation function: checks a single signal against an array of subsequent candles.
 */
export function evaluateSignalOutcome(
  signal: {
    direction: 'long' | 'short';
    entry_price: number;
    entry_price_limit?: number | null;
    stop_loss_pct: number;
    take_profit_pct: number;
    candle_time: number;
  },
  candles: Array<{
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>,
  options: EvaluationOptions = {},
): SignalResolution {
  const rawEntryPrice = signal.entry_price;
  const slPct = signal.stop_loss_pct;
  const tpPct = signal.take_profit_pct;
  const dir = signal.direction;

  if (rawEntryPrice <= 0 || slPct <= 0 || tpPct <= 0) {
    return { resolved: false };
  }

  const entryMode = options.entryMode ?? 'market';
  const maxWaitBars = options.maxWaitBars ?? 6;
  const breakevenAt1R = options.breakevenAt1R ?? false;

  // Filter strictly subsequent candles
  const postSignalCandles = candles.filter((c) => c.openTime > signal.candle_time);
  if (postSignalCandles.length === 0) {
    return { resolved: false };
  }

  let fillPrice = rawEntryPrice;
  let evalStartIdx = 0;

  // ── Phase A: Limit order fill discovery ────────────────────────────────────
  if (entryMode === 'limit') {
    const limitTarget =
      signal.entry_price_limit != null && signal.entry_price_limit > 0
        ? signal.entry_price_limit
        : computeEntryPriceLimit(rawEntryPrice, DEFAULT_ENTRY_OFFSET, dir);

    // If limitTarget equals rawEntryPrice, treat as immediate market fill
    if (Math.abs(limitTarget - rawEntryPrice) > 1e-9) {
      let filled = false;
      const searchLimit = Math.min(postSignalCandles.length, maxWaitBars);

      for (let i = 0; i < searchLimit; i++) {
        const c = postSignalCandles[i]!;
        const touched = dir === 'long' ? c.low <= limitTarget : c.high >= limitTarget;
        if (touched) {
          fillPrice =
            dir === 'long'
              ? Math.min(c.open, limitTarget)
              : Math.max(c.open, limitTarget);
          // Start checking TP/SL from the candle AFTER the limit fill candle,
          // unless the fill candle itself already breached the new SL.
          const initialSl =
            dir === 'long'
              ? fillPrice * (1 - slPct / 100)
              : fillPrice * (1 + slPct / 100);
          const breachedSlOnFillBar =
            dir === 'long' ? c.low <= initialSl : c.high >= initialSl;

          if (breachedSlOnFillBar) {
            return {
              resolved: true,
              actualEntryPrice: fillPrice,
              actualExitPrice: initialSl,
              pnlPct: -slPct,
              outcomeAt: c.closeTime,
              outcomeNote: `Auto (Limit): SL hit (-${slPct.toFixed(1)}%)`,
            };
          }

          filled = true;
          evalStartIdx = i + 1;
          break;
        }
      }

      if (!filled) {
        return {
          resolved: false,
          expired: postSignalCandles.length >= maxWaitBars,
          outcomeNote:
            postSignalCandles.length >= maxWaitBars
              ? `Auto: Limit unfilled (${maxWaitBars} bars)`
              : undefined,
        };
      }
    }
  }

  // ── Phase B: Evaluate TP / SL / 1R Breakeven+ on active position ───────────
  const tpPrice = dir === 'long' ? fillPrice * (1 + tpPct / 100) : fillPrice * (1 - tpPct / 100);
  const baseSlPrice = dir === 'long' ? fillPrice * (1 - slPct / 100) : fillPrice * (1 + slPct / 100);
  const oneRPrice = dir === 'long' ? fillPrice * (1 + slPct / 100) : fillPrice * (1 - slPct / 100);
  // Lock +0.15R profit once +1R is reached
  const lockedPnlPct = parseFloat((slPct * 0.15).toFixed(2));
  const beSlPrice =
    dir === 'long'
      ? fillPrice * (1 + lockedPnlPct / 100)
      : fillPrice * (1 - lockedPnlPct / 100);

  let reached1R = false;
  const modeTag = entryMode === 'limit' ? 'Auto (Limit)' : 'Auto';

  for (let i = evalStartIdx; i < postSignalCandles.length; i++) {
    const c = postSignalCandles[i]!;
    const activeSlPrice = reached1R ? beSlPrice : baseSlPrice;
    const activeSlPnl = reached1R ? lockedPnlPct : -slPct;
    const activeSlNote = reached1R
      ? `${modeTag}: 1R Trailing SL (+${lockedPnlPct.toFixed(2)}%)`
      : `${modeTag}: SL hit (-${slPct.toFixed(1)}%)`;

    if (dir === 'long') {
      const hitSl = c.low <= activeSlPrice;
      const hitTp = c.high >= tpPrice;

      if (hitSl && hitTp) {
        return {
          resolved: true,
          actualEntryPrice: fillPrice,
          actualExitPrice: activeSlPrice,
          pnlPct: activeSlPnl,
          outcomeAt: c.closeTime,
          outcomeNote: activeSlNote,
        };
      }
      if (hitSl) {
        return {
          resolved: true,
          actualEntryPrice: fillPrice,
          actualExitPrice: activeSlPrice,
          pnlPct: activeSlPnl,
          outcomeAt: c.closeTime,
          outcomeNote: activeSlNote,
        };
      }
      if (hitTp) {
        return {
          resolved: true,
          actualEntryPrice: fillPrice,
          actualExitPrice: tpPrice,
          pnlPct: tpPct,
          outcomeAt: c.closeTime,
          outcomeNote: `${modeTag}: TP hit (+${tpPct.toFixed(1)}%)`,
        };
      }

      if (breakevenAt1R && !reached1R && c.high >= oneRPrice) {
        reached1R = true;
      }
    } else {
      // short
      const hitSl = c.high >= activeSlPrice;
      const hitTp = c.low <= tpPrice;

      if (hitSl && hitTp) {
        return {
          resolved: true,
          actualEntryPrice: fillPrice,
          actualExitPrice: activeSlPrice,
          pnlPct: activeSlPnl,
          outcomeAt: c.closeTime,
          outcomeNote: activeSlNote,
        };
      }
      if (hitSl) {
        return {
          resolved: true,
          actualEntryPrice: fillPrice,
          actualExitPrice: activeSlPrice,
          pnlPct: activeSlPnl,
          outcomeAt: c.closeTime,
          outcomeNote: activeSlNote,
        };
      }
      if (hitTp) {
        return {
          resolved: true,
          actualEntryPrice: fillPrice,
          actualExitPrice: tpPrice,
          pnlPct: tpPct,
          outcomeAt: c.closeTime,
          outcomeNote: `${modeTag}: TP hit (+${tpPct.toFixed(1)}%)`,
        };
      }

      if (breakevenAt1R && !reached1R && c.low <= oneRPrice) {
        reached1R = true;
      }
    }
  }

  return { resolved: false };
}

/**
 * Load candles from DB hypertable and supplement missing tail from Binance.
 */
async function loadCandlesForPair(
  symbol: string,
  timeframe: string,
  minTime: number,
): Promise<Candle[]> {
  // 1. Fetch historical candles from DB
  const { rows } = await db.query<{
    open_time: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    close_time: Date;
  }>(
    `SELECT open_time, open, high, low, close, volume, close_time
     FROM candles
     WHERE symbol = $1 AND timeframe = $2 AND open_time >= $3
     ORDER BY open_time ASC`,
    [symbol, timeframe, new Date(minTime)],
  );

  const candles: Candle[] = rows.map((r) => ({
    openTime: r.open_time.getTime(),
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: parseFloat(r.volume),
    closeTime: r.close_time.getTime(),
  }));

  // 2. Check if fresh tail is missing from DB
  const lastTime = candles.length > 0 ? candles[candles.length - 1]!.openTime : minTime;
  const now = Date.now();
  const barMs = TF_TO_MS[timeframe as Timeframe] ?? 3600_000;

  if (now - lastTime > barMs) {
    try {
      const fresh = await fetchKlines(symbol, timeframe as Timeframe, 1000, lastTime + 1, true);
      for (const bar of fresh) {
        if (bar.openTime > lastTime) {
          candles.push(bar);
        }
      }
    } catch (err) {
      console.warn(`[resolver] Could not fetch tail candles from Binance for ${symbol}:${timeframe}:`, err);
    }
  }

  // Ensure strictly sorted ascending
  return candles.sort((a, b) => a.openTime - b.openTime);
}

export interface ResolveOptions {
  /** If true, re-evaluates all signals including existing ones. Defaults to true to resolve all signals. */
  forceAll?: boolean;
  /** Optional minimum timestamp (ms) to restrict resolution to signals fired on/after this time. */
  sinceMs?: number;
  /** Optional maximum timestamp (ms) to restrict resolution to signals fired on/before this time. */
  untilMs?: number;
  /** Entry execution mode: 'limit' (pullback to entry_price_limit) or 'market'. Default: 'limit'. */
  entryMode?: 'limit' | 'market';
  /** Max bars to wait for a limit order to fill before expiring. Default: 6. */
  maxWaitBars?: number;
  /** Lock +0.15R profit once trade reaches +1R in favor. Default: true. */
  breakevenAt1R?: boolean;
  /** Preserve manually recorded trades when forceAll is true. Default: true. */
  preserveManual?: boolean;
}

export interface ResolveSummary {
  totalSignals: number;
  evaluated: number;
  resolved: number;
  wins: number;
  losses: number;
  unfilled: number;
  stillOpen: number;
  winRate: number;
  totalPnl: number;
}

/**
 * Resolves strategy signals against historical & live candles.
 */
export async function resolveSignals(options: ResolveOptions = { forceAll: true }): Promise<ResolveSummary> {
  const forceAll = options.forceAll ?? true;
  const entryMode = options.entryMode ?? 'limit';
  const maxWaitBars = options.maxWaitBars ?? 6;
  const breakevenAt1R = options.breakevenAt1R ?? true;
  const preserveManual = options.preserveManual ?? true;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!forceAll) {
    conditions.push('pnl_pct IS NULL');
  } else if (preserveManual) {
    // Only re-evaluate signals that are open OR were previously auto-resolved
    conditions.push(`(actual_entry_price IS NULL OR outcome_note LIKE 'Auto%')`);
  }
  if (typeof options.sinceMs === 'number' && Number.isFinite(options.sinceMs)) {
    params.push(new Date(options.sinceMs));
    conditions.push(`fired_at >= $${params.length}`);
  }
  if (typeof options.untilMs === 'number' && Number.isFinite(options.untilMs)) {
    params.push(new Date(options.untilMs));
    conditions.push(`fired_at <= $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 1. Query signals
  const query = `SELECT id, strategy_name, symbol, timeframe, direction, entry_price, entry_price_limit,
                        stop_loss_pct, take_profit_pct, candle_time, pnl_pct, outcome_note
                 FROM strategy_signals
                 ${whereClause}
                 ORDER BY candle_time ASC`;

  const { rows } = await db.query<{
    id: number;
    strategy_name: string;
    symbol: string;
    timeframe: string;
    direction: string;
    entry_price: string;
    entry_price_limit: string | null;
    stop_loss_pct: string;
    take_profit_pct: string;
    candle_time: Date;
    pnl_pct: string | null;
    outcome_note: string | null;
  }>(query, params);

  const signals: CandidateSignal[] = rows.map((r) => ({
    id: r.id,
    strategy_name: r.strategy_name,
    symbol: r.symbol,
    timeframe: r.timeframe,
    direction: r.direction as 'long' | 'short',
    entry_price: parseFloat(r.entry_price),
    entry_price_limit: r.entry_price_limit !== null ? parseFloat(r.entry_price_limit) : null,
    stop_loss_pct: parseFloat(r.stop_loss_pct),
    take_profit_pct: parseFloat(r.take_profit_pct),
    candle_time: r.candle_time.getTime(),
    pnl_pct: r.pnl_pct !== null ? parseFloat(r.pnl_pct) : null,
    outcome_note: r.outcome_note,
  }));

  // Group signals by symbol:timeframe
  const groups = new Map<string, CandidateSignal[]>();
  for (const s of signals) {
    const key = `${s.symbol}:${s.timeframe}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  let wins = 0;
  let losses = 0;
  let unfilled = 0;
  let totalPnl = 0;
  const updates: Array<{
    id: number;
    actualEntryPrice: number | null;
    actualExitPrice: number | null;
    pnlPct: number | null;
    outcomeNote: string | null;
    outcomeAt: Date | null;
  }> = [];

  for (const [key, sigs] of groups.entries()) {
    const [symbol, tf] = key.split(':');
    if (!symbol || !tf) continue;

    const minTime = Math.min(...sigs.map((s) => s.candle_time));
    const candles = await loadCandlesForPair(symbol, tf, minTime);

    for (const sig of sigs) {
      const res = evaluateSignalOutcome(sig, candles, {
        entryMode,
        maxWaitBars,
        breakevenAt1R,
      });
      if (res.resolved && res.actualEntryPrice != null && res.actualExitPrice != null && res.pnlPct != null) {
        if (res.pnlPct > 0) wins++;
        else if (res.pnlPct < 0) losses++;
        totalPnl += res.pnlPct;

        updates.push({
          id: sig.id,
          actualEntryPrice: res.actualEntryPrice,
          actualExitPrice: res.actualExitPrice,
          pnlPct: res.pnlPct,
          outcomeNote: res.outcomeNote ?? 'Auto-resolved',
          outcomeAt: new Date(res.outcomeAt ?? Date.now()),
        });
      } else {
        if (res.expired) unfilled++;
        // If this signal was previously auto-resolved (e.g. under market mode)
        // and is now unfilled/unresolved under limit mode, clear the stale outcome.
        if (sig.pnl_pct !== null || sig.outcome_note !== res.outcomeNote) {
          updates.push({
            id: sig.id,
            actualEntryPrice: null,
            actualExitPrice: null,
            pnlPct: null,
            outcomeNote: res.outcomeNote ?? null,
            outcomeAt: null,
          });
        }
      }
    }
  }

  // 2. Batch update DB in a transaction
  if (updates.length > 0) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const u of updates) {
        await client.query(
          `UPDATE strategy_signals
           SET actual_entry_price = $2,
               actual_exit_price  = $3,
               pnl_pct            = $4,
               outcome_note       = $5,
               outcome_at         = $6
           WHERE id = $1`,
          [u.id, u.actualEntryPrice, u.actualExitPrice, u.pnlPct, u.outcomeNote, u.outcomeAt],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Get total count of signals in the target scope
  const countConditions: string[] = [];
  const countParams: unknown[] = [];
  if (typeof options.sinceMs === 'number' && Number.isFinite(options.sinceMs)) {
    countParams.push(new Date(options.sinceMs));
    countConditions.push(`fired_at >= $${countParams.length}`);
  }
  if (typeof options.untilMs === 'number' && Number.isFinite(options.untilMs)) {
    countParams.push(new Date(options.untilMs));
    countConditions.push(`fired_at <= $${countParams.length}`);
  }
  const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';
  const countRes = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM strategy_signals ${countWhere}`,
    countParams,
  );
  const totalSignals = parseInt(countRes.rows[0]?.count ?? '0', 10);
  const resolved = wins + losses;
  const stillOpen = Math.max(0, totalSignals - resolved - unfilled);
  const winRate = resolved > 0 ? (wins / resolved) * 100 : 0;

  return {
    totalSignals,
    evaluated: signals.length,
    resolved,
    wins,
    losses,
    unfilled,
    stillOpen,
    winRate: parseFloat(winRate.toFixed(2)),
    totalPnl: parseFloat(totalPnl.toFixed(2)),
  };
}
