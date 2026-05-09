'use client';

/**
 * CandleTimer — countdown to the current candle's close.
 *
 * Rendered as an absolute overlay on the price pane, positioned directly below
 * the live price label on the right price axis — mirroring TradingView's timer.
 *
 * ChartLayout is responsible for computing `yPx` via
 * priceRef.current.priceToCoordinate(currentPrice) and passing it here.
 * The component repositions itself whenever yPx changes (price tick, zoom, scroll).
 *
 * Props:
 *   closeTimeMs — Unix ms of the current forming candle's close time.
 *   yPx         — Y pixel from the top of the price pane for the current price.
 *                 The timer is rendered just below this point (price label height ≈ 22px).
 *   priceAxisWidth — width of the right price axis in px (default 80).
 */

import { useEffect, useState } from 'react';

interface Props {
  closeTimeMs:    number;
  yPx:            number;
  priceAxisWidth?: number;
}

/** Format remaining milliseconds as M:SS or H:MM:SS. */
function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h   = Math.floor(totalSec / 3600);
  const m   = Math.floor((totalSec % 3600) / 60);
  const s   = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function CandleTimer({ closeTimeMs, yPx, priceAxisWidth = 80 }: Props) {
  const [remaining, setRemaining] = useState(() => closeTimeMs - Date.now());

  useEffect(() => {
    setRemaining(closeTimeMs - Date.now());
  }, [closeTimeMs]);

  useEffect(() => {
    const id = setInterval(() => setRemaining(closeTimeMs - Date.now()), 1_000);
    return () => clearInterval(id);
  }, [closeTimeMs]);

  if (remaining < 0 || remaining > 7 * 24 * 3_600_000) return null;

  // Price label height on LWC's price axis is ~22px — place timer just below it.
  const LABEL_H = 22;

  return (
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center"
      style={{
        top:    yPx + LABEL_H,
        right:  0,
        width:  priceAxisWidth,
        height: LABEL_H,
      }}
    >
      {/* Pill styled to match the price axis label look */}
      <div className="flex items-center justify-center w-full h-full
                      bg-[#1e2a3d] border border-[#2a3a55] rounded-sm">
        <span className="font-mono text-[11px] text-[#93c5fd] tabular-nums tracking-wide">
          {formatRemaining(remaining)}
        </span>
      </div>
    </div>
  );
}

/** Inline variant for the top bar (price + timer stacked). */
export function CandleTimerInline({ closeTimeMs }: { closeTimeMs: number }) {
  const [remaining, setRemaining] = useState(() => closeTimeMs - Date.now());

  useEffect(() => {
    setRemaining(closeTimeMs - Date.now());
  }, [closeTimeMs]);

  useEffect(() => {
    const id = setInterval(() => setRemaining(closeTimeMs - Date.now()), 1_000);
    return () => clearInterval(id);
  }, [closeTimeMs]);

  if (remaining < 0 || remaining > 7 * 24 * 3_600_000) return null;

  return (
    <span className="font-mono text-[10px] text-text-muted tabular-nums">
      {formatRemaining(remaining)}
    </span>
  );
}
