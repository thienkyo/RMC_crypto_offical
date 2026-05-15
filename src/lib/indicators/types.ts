import type { Candle } from '@/types/market';

/** A single (time, value) data point for a chart series. */
export interface IndicatorPoint {
  /** Unix milliseconds matching Candle.openTime. */
  time: number;
  value: number;
  /** Per-point color override — used by histogram bars (e.g. MACD). */
  color?: string;
}

/** A marker rendered on a series at a specific bar (e.g. RSI/EMA crossovers). */
export interface IndicatorMarker {
  time: number;  // unix ms
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown';
  size?: number;
  text?: string;
}

/** One rendered series produced by an indicator. */
export interface IndicatorSeries {
  /** Unique ID scoped to this indicator run, e.g. "ema_20" or "macd_hist". */
  id: string;
  /** Human-readable label shown in legend. */
  name: string;
  data: IndicatorPoint[];
  /** "overlay" → rendered on the price chart; "sub" → separate pane below. */
  panel: 'overlay' | 'sub';
  /** Default line/bar color. */
  color: string;
  lineWidth?: number;
  seriesType: 'line' | 'histogram';
  /** Optional markers rendered on top of this series (e.g. crossover dots). */
  markers?: IndicatorMarker[];
}

/** Everything an indicator returns — one or more series. */
export type IndicatorResult = IndicatorSeries[];

/**
 * Metadata about a single configurable parameter.
 * Used to auto-generate the config popup UI.
 *
 * type 'number'  (default) — renders a numeric spinner.
 * type 'time'              — renders an HH:MM time picker; value is stored as
 *                            total minutes from midnight (0–1439), e.g. 480 = 08:00.
 * type 'select'            — renders a <select> dropdown; value is a number.
 */
export type ParamMeta =
  | { type?: 'number'; label: string; min: number; max: number; step: number }
  | { type: 'time';   label: string }
  | { type: 'select'; label: string; options: { label: string; value: number }[] }

/**
 * The contract every indicator must implement.
 * P is the params shape, e.g. { period: number } for EMA.
 */
export interface Indicator<P extends Record<string, number> = Record<string, number>> {
  id: string;
  name: string;
  description?: string;
  /**
   * Signal direction for candlestick pattern indicators.
   * Undefined for price/oscillator indicators that have no directional bias.
   * Rendered as a colored pill tag in the IndicatorSelector dropdown.
   */
  bias?: 'bullish' | 'bearish';
  /**
   * When true the operator + threshold fields are hidden in the condition row
   * UI and locked to `gt / 0.5`.  Use for binary (0/1) indicators like
   * time_of_day where the threshold is always the same.
   */
  hideThreshold?: true;
  defaultParams: P;
  /** Metadata for each param key — drives the config popup UI. */
  paramsMeta: Record<keyof P, ParamMeta>;
  /** Pure function: candles → series data. Never mutates inputs. */
  compute(candles: Candle[], params: P): IndicatorResult;
}
