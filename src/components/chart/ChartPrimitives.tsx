'use client';

/**
 * ChartPrimitives — modular UI sub-components extracted from ChartLayout:
 * - ExtremeMarker: Price chip + caret marking the visible range high/low
 * - PaneResizer: Drag strip between price pane and indicator sub-panes
 * - LivePriceBadge: Header price & 24h/prev-bar % change display
 */

import { useRef, useCallback, memo } from 'react';
import { formatChartPrice as fmtPrice } from '@/lib/format';

export const SUB_HEIGHT_MIN = 60;
export const SUB_HEIGHT_MAX = 500;
export const SUB_HEIGHT_DEFAULT: Record<string, number> = {
  macd: 140,
};
export const SUB_HEIGHT_FALLBACK = 120;

/** One visible-range extreme, already resolved to pane pixel coordinates. */
export interface ExtremePoint {
  x:     number;
  y:     number;
  price: number;
  /** Chip sits above the bar (caret points down) rather than below it. */
  above: boolean;
}

export function samePoint(a: ExtremePoint | null, b: ExtremePoint | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.price === b.price && a.above === b.above;
}

/**
 * Price chip + caret marking one extreme of the visible range, pinned to the
 * bar that printed it.
 */
export const ExtremeMarker = memo(function ExtremeMarker({
  point,
  colorClass,
}: {
  point: ExtremePoint;
  colorClass: string;
}) {
  const { x, y, price, above } = point;
  return (
    <div
      className={`absolute z-20 pointer-events-none flex flex-col items-center gap-px
                  font-mono text-[10px] leading-none whitespace-nowrap ${colorClass}`}
      style={{
        left:      x,
        top:       y + (above ? -6 : 6),
        transform: `translate(-50%, ${above ? '-100%' : '0%'})`,
      }}
    >
      {!above && <span className="text-[8px] opacity-80">▲</span>}
      <span className="px-1 py-px rounded-sm tabular-nums
                       bg-surface-2/90 border border-surface-border">
        {fmtPrice(price)}
      </span>
      {above && <span className="text-[8px] opacity-80">▼</span>}
    </div>
  );
});

/**
 * Thin drag strip rendered at the top of each sub-pane.
 * Dragging up → pane grows; dragging down → pane shrinks.
 */
export const PaneResizer = memo(function PaneResizer({
  onDelta,
}: {
  onDelta: (delta: number) => void;
}) {
  const isDragging = useRef(false);
  const lastY      = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    lastY.current = e.clientY;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = lastY.current - ev.clientY; // up = positive = grow
      lastY.current = ev.clientY;
      onDelta(delta);
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [onDelta]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-full h-1.5 cursor-ns-resize flex-shrink-0 group relative z-10
                 border-t border-surface-border
                 hover:border-accent/60 active:border-accent transition-colors"
      title="Drag to resize"
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 mx-auto w-10
                      rounded-full bg-surface-border group-hover:bg-accent/50
                      group-active:bg-accent transition-colors" />
    </div>
  );
});

/**
 * Isolated header badge displaying the live price and percentage change.
 */
export const LivePriceBadge = memo(function LivePriceBadge({
  displayPrice,
  priceChange,
}: {
  displayPrice: number | undefined;
  priceChange: number;
}) {
  if (displayPrice === undefined) return null;
  return (
    <>
      <span className="font-mono text-text-price text-sm">
        {fmtPrice(displayPrice)}
      </span>
      <span className={`font-mono text-xs ${priceChange >= 0 ? 'text-up' : 'text-down'}`}>
        {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
      </span>
    </>
  );
});
