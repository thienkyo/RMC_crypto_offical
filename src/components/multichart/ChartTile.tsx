'use client';

import { useState, useMemo, useCallback } from 'react';
import type { UTCTimestamp, SeriesMarker } from 'lightweight-charts';
import { clsx } from 'clsx';
import { PriceChart } from '@/components/chart/PriceChart';
import { useTileCandles } from '@/hooks/useTileCandles';
import { useMultiChartStore, type ChartTileConfig } from '@/store/multichart';
import { useStrategyStore } from '@/store/strategy';
import { ema } from '@/lib/indicators/ema';
import { bollinger } from '@/lib/indicators/bollinger';
import { computeSignalCandles } from '@/lib/strategy/signals';
import type { IndicatorSeries } from '@/lib/indicators/types';
import type { Timeframe } from '@/types/market';

const QUICK_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

interface ChartTileProps {
  tile: ChartTileConfig;
  sharedCrosshairTime?: UTCTimestamp | null;
  onCrosshairMove?: (time: UTCTimestamp | null) => void;
  isMaximized?: boolean;
}

function formatTilePrice(p: number | null): string {
  if (p === null || isNaN(p)) return '—';
  return p.toLocaleString('en-US', {
    minimumFractionDigits: p < 1 ? 4 : 2,
    maximumFractionDigits: p < 1 ? 6 : 2,
  });
}

export function ChartTile({
  tile,
  sharedCrosshairTime,
  onCrosshairMove,
  isMaximized = false,
}: ChartTileProps) {
  const syncCrosshair = useMultiChartStore((s) => s.syncCrosshair);
  const overlayConfig = useMultiChartStore((s) => s.overlays);
  const updateTile = useMultiChartStore((s) => s.updateTile);
  const toggleMaximizeTile = useMultiChartStore((s) => s.toggleMaximizeTile);
  const strategies = useStrategyStore((s) => s.strategies);

  const [symbolEditing, setSymbolEditing] = useState(false);
  const [symbolInput, setSymbolInput] = useState(tile.symbol);

  // Fetch candles & listen to live ticks
  const { candles, livePrice, isLoading, isError, error } = useTileCandles({
    symbol: tile.symbol,
    timeframe: tile.timeframe,
  });

  // Calculate indicator overlays (BB, EMA 20, EMA 90, EMA 200)
  const computedOverlays = useMemo<IndicatorSeries[]>(() => {
    if (candles.length === 0) return [];
    const list: IndicatorSeries[] = [];

    if (overlayConfig.bb) {
      try {
        const bbSeries = bollinger.compute(candles, { period: 20, stdDevMult: 2 });
        list.push(...bbSeries);
      } catch {
        // Safe to skip on insufficient candles
      }
    }

    if (overlayConfig.ema20) {
      try {
        const s = ema.compute(candles, { period: 20 });
        list.push(...s.map((item) => ({ ...item, color: '#38bdf8' }))); // sky-blue
      } catch {
        // Safe to skip
      }
    }

    if (overlayConfig.ema90) {
      try {
        const s = ema.compute(candles, { period: 90 });
        list.push(...s.map((item) => ({ ...item, color: '#f59e0b' }))); // amber
      } catch {
        // Safe to skip
      }
    }

    if (overlayConfig.ema200) {
      try {
        const s = ema.compute(candles, { period: 200 });
        list.push(...s.map((item) => ({ ...item, color: '#a855f7' }))); // purple
      } catch {
        // Safe to skip
      }
    }

    return list;
  }, [
    candles,
    overlayConfig.bb,
    overlayConfig.ema20,
    overlayConfig.ema90,
    overlayConfig.ema200,
  ]);

  // Strategy entry signals matched to this tile's symbol and timeframe
  const markers = useMemo<SeriesMarker<UTCTimestamp>[]>(() => {
    if (!overlayConfig.signals || candles.length < 2) return [];

    const matched = strategies.filter(
      (s) =>
        s.isActive &&
        s.symbol.toUpperCase() === tile.symbol.toUpperCase() &&
        s.timeframe === tile.timeframe,
    );
    if (matched.length === 0) return [];

    const result: SeriesMarker<UTCTimestamp>[] = [];
    const seenTimes = new Set<string>();

    for (const strat of matched) {
      const rawSignals = computeSignalCandles(strat, candles);
      for (const sig of rawSignals) {
        const timeSec = Math.floor(sig.openTimeMs / 1000) as UTCTimestamp;
        const position = sig.direction === 'long' ? 'belowBar' : 'aboveBar';
        const key = `${timeSec}:${position}`;
        if (seenTimes.has(key)) continue;
        seenTimes.add(key);

        result.push({
          time: timeSec,
          position,
          color: sig.direction === 'long' ? '#10b981' : '#ef4444',
          shape: sig.direction === 'long' ? 'arrowUp' : 'arrowDown',
          text: strat.name.slice(0, 4),
          size: 1,
        });
      }
    }

    return result.sort((a, b) => (a.time as number) - (b.time as number));
  }, [candles, overlayConfig.signals, strategies, tile.symbol, tile.timeframe]);

  const handleCommitSymbol = useCallback(() => {
    setSymbolEditing(false);
    const cleaned = symbolInput.trim().toUpperCase();
    if (cleaned && cleaned !== tile.symbol) {
      updateTile(tile.id, { symbol: cleaned });
    } else {
      setSymbolInput(tile.symbol);
    }
  }, [symbolInput, tile.id, tile.symbol, updateTile]);

  const contextKey = `${tile.symbol}-${tile.timeframe}`;

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0e1a] border border-[#1e2a3d] rounded-sm overflow-hidden select-none">
      {/* ── Tile Header Bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1 bg-[#0d1322] border-b border-[#1e2a3d] text-xs">
        {/* Left: Symbol & Timeframe pills */}
        <div className="flex items-center gap-2">
          {symbolEditing ? (
            <input
              type="text"
              autoFocus
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              onBlur={handleCommitSymbol}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitSymbol();
                if (e.key === 'Escape') {
                  setSymbolInput(tile.symbol);
                  setSymbolEditing(false);
                }
              }}
              className="w-20 px-1 py-0.5 bg-[#141c2e] border border-blue-500 rounded text-xs font-mono font-bold text-white outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setSymbolInput(tile.symbol);
                setSymbolEditing(true);
              }}
              title="Click to change symbol"
              className="font-mono font-bold text-white hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              <span>{tile.symbol}</span>
              <span className="text-[10px] text-gray-500 font-normal">✎</span>
            </button>
          )}

          {/* Timeframe selector pills */}
          <div className="flex items-center gap-0.5 bg-[#141c2e] rounded px-1 py-0.5">
            {QUICK_TIMEFRAMES.map((tf) => {
              const active = tile.timeframe === tf;
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => updateTile(tile.id, { timeframe: tf })}
                  className={clsx(
                    'px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors',
                    active
                      ? 'bg-blue-600 text-white font-bold'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3d]',
                  )}
                >
                  {tf}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center / Right: Live price, active overlays indicators, maximize button */}
        <div className="flex items-center gap-2.5">
          {/* Active indicator badges */}
          <div className="hidden sm:flex items-center gap-1 text-[9px] font-mono">
            {overlayConfig.bb && (
              <span className="text-indigo-400 bg-indigo-950/60 px-1 rounded">BB</span>
            )}
            {overlayConfig.ema20 && (
              <span className="text-sky-400 bg-sky-950/60 px-1 rounded">E20</span>
            )}
            {overlayConfig.ema90 && (
              <span className="text-amber-400 bg-amber-950/60 px-1 rounded">E90</span>
            )}
            {overlayConfig.ema200 && (
              <span className="text-purple-400 bg-purple-950/60 px-1 rounded">E200</span>
            )}
            {overlayConfig.signals && markers.length > 0 && (
              <span className="text-emerald-400 bg-emerald-950/60 px-1 rounded">
                SIG ({markers.length})
              </span>
            )}
          </div>

          {/* Live price badge */}
          <div className="font-mono font-semibold text-xs text-white">
            ${formatTilePrice(livePrice)}
          </div>

          {/* Maximize / Restore tile */}
          <button
            type="button"
            onClick={() => toggleMaximizeTile(tile.id)}
            title={isMaximized ? 'Restore grid view' : 'Maximize this tile'}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#1e2a3d] transition-colors text-sm leading-none"
          >
            {isMaximized ? '⤓' : '⤢'}
          </button>
        </div>
      </div>

      {/* ── Chart Container ── */}
      <div className="flex-1 relative min-h-0 min-w-0">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a0e1a]/80 backdrop-blur-xs text-gray-400 text-xs font-mono">
            Loading {tile.symbol} {tile.timeframe}…
          </div>
        )}

        {isError && candles.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0a0e1a] text-rose-400 text-xs font-mono p-4 text-center">
            <span>Failed to load {tile.symbol}</span>
            <span className="text-[10px] text-gray-500 mt-1">{error?.message}</span>
          </div>
        )}

        <PriceChart
          candles={candles}
          overlays={computedOverlays}
          contextKey={contextKey}
          dataKey={candles.length > 0 ? contextKey : null}
          crosshairTime={syncCrosshair ? sharedCrosshairTime : null}
          onCrosshair={
            syncCrosshair
              ? (time) => {
                  onCrosshairMove?.(time);
                }
              : undefined
          }
          markers={markers}
          showTimeAxis={true}
        />
      </div>
    </div>
  );
}
