'use client';

/**
 * CandleTimer — countdown to the current candle's close.
 *
 * Rendered as an absolute overlay on the price pane, pinned to the SAME row as
 * the live price label but on the chart side of the right price axis (i.e. just
 * left of the axis tick labels), so it never drops onto — and obscures —
 * unrelated mid-scale price ticks when the last price sits near the top/bottom
 * of the visible scale.
 *
 * ChartLayout is responsible for computing `yPx` via
 * priceRef.current.priceToCoordinate(currentPrice) and passing it here.
 * The component repositions itself whenever yPx changes (price tick, zoom, scroll).
 *
 * Props:
 *   closeTimeMs — Unix ms of the current forming candle's close time.
 *   yPx         — Y pixel from the top of the price pane for the current price.
 *                 The timer is vertically centered on this point, matching the
 *                 last-price label's row.
 *   priceAxisWidth — width of the right price axis in px (default 80); the timer
 *                    is offset left by this amount so it sits beside the axis,
 *                    not on top of it.
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

  // Price label row height on LWC's price axis is ~22px; the chip itself is
  // narrower than the full axis width since it floats beside the axis, not on it.
  const LABEL_H = 22;
  const CHIP_W  = 52;

  return (
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center"
      style={{
        top:    yPx - LABEL_H / 2,
        right:  priceAxisWidth,
        width:  CHIP_W,
        height: LABEL_H,
      }}
    >
      {/* Pill styled to match the price axis label look, pinned to the last-price row */}
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
