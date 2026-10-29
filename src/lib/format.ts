/**
 * Shared Price, Number, Date, and HTML Formatting Utilities.
 */

export interface FormatPriceOptions {
  /** Prepend '$' sign (default: false). */
  symbol?: boolean;
  /** Number of decimals when value < 1 (default: 6). */
  smallDecimals?: number;
  /** Number of decimals when value >= 1000 and symbol is true (default: 0). */
  largeDecimals?: number;
}

/**
 * Formats a price for chart readouts (no '$' prefix, 2 decimals for >= 1, 6 decimals for < 1).
 * Matches the previous `fmtPrice` in `ChartLayout.tsx` and `ChartLegend.tsx`.
 */
export function formatChartPrice(v: number): string {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: v < 1 ? 6 : 2,
  });
}

/**
 * Formats a USD price with a '$' prefix:
 * - `>= 1000`: `$62,840`
 * - `>= 1`:    `$12.34`
 * - `< 1`:     `$0.042300` (or `smallDecimals`, e.g. 4 for compact badges)
 */
export function formatUsdPrice(price: number, smallDecimals = 6): string {
  if (price >= 1000) {
    return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (price >= 1) {
    return '$' + price.toFixed(2);
  }
  return '$' + price.toFixed(smallDecimals);
}

/**
 * Formats a price for SVG chart labels with high precision across tiers:
 * - `>= 1000`: 2 decimals
 * - `>= 1`:    3–4 decimals
 * - `< 1`:     5–6 decimals
 */
export function formatAxisPrice(val: number): string {
  if (val >= 1000) {
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (val >= 1) {
    return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  }
  return val.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
}

/**
 * Formats a percentage with explicit `+` or `-` sign (e.g. `+2.45%`, `-1.10%`).
 */
export function formatSignedPct(n: number, decimals = 2): string {
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%';
}

/**
 * Formats an indicator value with adaptive precision.
 */
export function formatIndicatorValue(v: number): string {
  if (Number.isNaN(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

/**
 * Escape HTML special characters (`&`, `<`, `>`) for safe embedding in Telegram HTML or SVG.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats a Unix-ms timestamp as `"YYYY-MM-DD HH:MM (UTC+7)"`.
 */
export function formatUtc7Timestamp(ms: number): string {
  const d = new Date(ms);
  d.setUTCHours(d.getUTCHours() + 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} (UTC+7)`
  );
}
