/**
 * Server-Side Signal Chart Generator.
 *
 * Renders a 1000x560 dark-themed candlestick chart as an SVG string, then
 * rasterizes it to a PNG Buffer via `sharp` in ~15-25ms.
 *
 * Features:
 * - Up to 80 recent candlesticks + volume histogram.
 * - Prominent header (Symbol, Timeframe, Direction pill, Strategy Name, Rating, sig#ID).
 * - Shaded Risk/Reward zones & horizontal Entry / SL / TP / Max limit lines with badges.
 * - Signal trigger marker (▲ BUY / ▼ SELL) on the firing candle.
 */

import sharp from 'sharp';
import type { Candle } from '@/types/market';

export interface SignalChartParams {
  symbol: string;
  timeframe: string;
  strategyName: string;
  direction: 'long' | 'short';
  rating: number;
  entryPrice: number;
  entryPriceLimit?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  candles: Candle[];
  signalId?: number;
}

function formatPrice(val: number): string {
  if (val >= 1000) {
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (val >= 1) {
    return val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  }
  return val.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
}

function formatDate(ms: number, timeframe: string): string {
  const d = new Date(ms);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');

  if (['1d', '3d', '1w'].includes(timeframe.toLowerCase())) {
    return `${day} ${month}`;
  }
  return `${day} ${month} ${hours}:${mins}`;
}

export function generateSignalChartSvg(params: SignalChartParams): string {
  const {
    symbol,
    timeframe,
    strategyName,
    direction,
    rating,
    entryPrice,
    entryPriceLimit,
    stopLossPrice,
    takeProfitPrice,
    stopLossPct,
    takeProfitPct,
    candles,
    signalId,
  } = params;

  const width = 1000;
  const height = 560;

  // Geometry
  const plotLeft = 16;
  const plotTop = 64;
  const plotWidth = 864;
  const plotHeight = 440;
  const plotRight = plotLeft + plotWidth;
  const plotBottom = plotTop + plotHeight;
  const volumeHeight = 65;

  // Visible bars (up to 80)
  const visibleCandles = candles.slice(-80);
  const barCount = Math.max(visibleCandles.length, 1);
  const barStep = plotWidth / barCount;
  const barWidth = Math.max(3, Math.min(18, barStep * 0.72));

  // Determine min & max prices across candles and target levels
  let minP = Infinity;
  let maxP = -Infinity;

  for (const c of visibleCandles) {
    if (c.low < minP) minP = c.low;
    if (c.high > maxP) maxP = c.high;
  }

  // Include target levels in bounding range
  const candidatePrices = [
    entryPrice,
    entryPriceLimit,
    stopLossPrice,
    takeProfitPrice,
  ].filter((p): p is number => typeof p === 'number' && p > 0);

  for (const p of candidatePrices) {
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }

  if (!isFinite(minP) || !isFinite(maxP) || minP === maxP) {
    minP = entryPrice * 0.95;
    maxP = entryPrice * 1.05;
  }

  // 4% top and bottom padding
  const pRange = maxP - minP;
  const paddedMin = minP - pRange * 0.04;
  const paddedMax = maxP + pRange * 0.04;
  const activeRange = paddedMax - paddedMin || 1;

  const toY = (price: number): number => {
    return plotTop + ((paddedMax - price) / activeRange) * (plotHeight - 10);
  };

  // Max volume for bottom histogram
  const maxVol = Math.max(...visibleCandles.map((c) => c.volume || 0), 1);

  // SVG Elements
  const candleElements: string[] = [];
  const volumeElements: string[] = [];

  visibleCandles.forEach((c, idx) => {
    const xCenter = plotLeft + idx * barStep + barStep / 2;
    const isBull = c.close >= c.open;
    const color = isBull ? '#10b981' : '#ef4444';

    // Volume bar
    const vol = c.volume || 0;
    const vH = Math.max(2, (vol / maxVol) * volumeHeight);
    const vY = plotBottom - vH;
    const vFill = isBull ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)';
    volumeElements.push(
      `<rect x="${(xCenter - barWidth / 2).toFixed(1)}" y="${vY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${vH.toFixed(1)}" fill="${vFill}" rx="1"/>`,
    );

    // Candle Wick
    const wickTop = toY(c.high);
    const wickBottom = toY(c.low);
    candleElements.push(
      `<line x1="${xCenter.toFixed(1)}" y1="${wickTop.toFixed(1)}" x2="${xCenter.toFixed(1)}" y2="${wickBottom.toFixed(1)}" stroke="${color}" stroke-width="1.2"/>`,
    );

    // Candle Body
    const bodyTop = toY(Math.max(c.open, c.close));
    const bodyBottom = toY(Math.min(c.open, c.close));
    const bodyH = Math.max(1.5, bodyBottom - bodyTop);
    const bodyX = xCenter - barWidth / 2;
    candleElements.push(
      `<rect x="${bodyX.toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${color}" rx="1"/>`,
    );
  });

  // Gridlines & price labels (5 horizontal intervals)
  const gridElements: string[] = [];
  const gridCount = 5;
  for (let i = 0; i <= gridCount; i++) {
    const p = paddedMin + (activeRange * i) / gridCount;
    const y = toY(p);
    if (y < plotTop || y > plotBottom) continue;

    gridElements.push(
      `<line x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotRight}" y2="${y.toFixed(1)}" stroke="#1e293b" stroke-width="1" stroke-dasharray="4,4"/>`,
      `<text x="${plotRight + 8}" y="${(y + 3.5).toFixed(1)}" fill="#64748b" font-size="10" font-family="monospace">${formatPrice(p)}</text>`,
    );
  }

  // Time Axis labels (every ~12 bars)
  const timeElements: string[] = [];
  const timeStepCount = Math.max(4, Math.floor(barCount / 12));
  const timeStepInterval = Math.floor(barCount / timeStepCount);

  for (let idx = 0; idx < barCount; idx += timeStepInterval) {
    const c = visibleCandles[idx];
    if (!c) continue;
    const xCenter = plotLeft + idx * barStep + barStep / 2;
    const dateStr = formatDate(c.openTime, timeframe);
    timeElements.push(
      `<text x="${xCenter.toFixed(1)}" y="${plotBottom + 18}" fill="#64748b" font-size="10" font-family="monospace" text-anchor="middle">${dateStr}</text>`,
    );
  }

  // Shaded Risk / Reward Zones & Horizontal Lines
  const zoneElements: string[] = [];
  const zoneX = plotLeft + plotWidth * 0.65;
  const zoneW = plotWidth * 0.35;

  const entryY = toY(entryPrice);
  const slY = stopLossPrice ? toY(stopLossPrice) : null;
  const tpY = takeProfitPrice ? toY(takeProfitPrice) : null;
  const maxLimitY = entryPriceLimit && Math.abs(entryPriceLimit - entryPrice) > entryPrice * 0.0001
    ? toY(entryPriceLimit)
    : null;

  // Reward Zone (Green Tint)
  if (tpY !== null) {
    const top = Math.min(entryY, tpY);
    const bottom = Math.max(entryY, tpY);
    zoneElements.push(
      `<rect x="${zoneX.toFixed(1)}" y="${top.toFixed(1)}" width="${zoneW.toFixed(1)}" height="${(bottom - top).toFixed(1)}" fill="rgba(16, 185, 129, 0.15)"/>`,
    );
  }

  // Risk Zone (Red Tint)
  if (slY !== null) {
    const top = Math.min(entryY, slY);
    const bottom = Math.max(entryY, slY);
    zoneElements.push(
      `<rect x="${zoneX.toFixed(1)}" y="${top.toFixed(1)}" width="${zoneW.toFixed(1)}" height="${(bottom - top).toFixed(1)}" fill="rgba(239, 68, 68, 0.15)"/>`,
    );
  }

  // Helper for dashed level line with right pill badge
  const renderLevel = (
    y: number,
    color: string,
    bgColor: string,
    label: string,
  ): string => {
    const pillW = label.length * 6.5 + 16;
    const pillH = 18;
    const pillX = plotRight - pillW - 6;
    const pillY = y - pillH / 2;

    return `
      <line x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotRight}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="6,4"/>
      <rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" fill="${bgColor}" stroke="${color}" stroke-width="1"/>
      <text x="${(pillX + pillW / 2).toFixed(1)}" y="${(pillY + 12.5).toFixed(1)}" fill="#ffffff" font-size="10" font-weight="bold" font-family="monospace" text-anchor="middle">${label}</text>
    `;
  };

  const levelElements: string[] = [];

  // TP Level
  if (tpY !== null && takeProfitPrice) {
    const pctStr = takeProfitPct !== undefined ? ` (+${takeProfitPct.toFixed(1)}%)` : '';
    levelElements.push(
      renderLevel(tpY, '#10b981', 'rgba(16, 185, 129, 0.90)', `TP: $${formatPrice(takeProfitPrice)}${pctStr}`),
    );
  }

  // SL Level
  if (slY !== null && stopLossPrice) {
    const pctStr = stopLossPct !== undefined ? ` (-${stopLossPct.toFixed(1)}%)` : '';
    levelElements.push(
      renderLevel(slY, '#ef4444', 'rgba(239, 68, 68, 0.90)', `SL: $${formatPrice(stopLossPrice)}${pctStr}`),
    );
  }

  // Entry Level
  levelElements.push(
    renderLevel(entryY, '#38bdf8', 'rgba(2, 132, 199, 0.92)', `ENTRY: $${formatPrice(entryPrice)}`),
  );

  // Max Entry Limit Level (if different from entry)
  if (maxLimitY !== null && entryPriceLimit) {
    levelElements.push(
      renderLevel(maxLimitY, '#f59e0b', 'rgba(217, 119, 6, 0.90)', `MAX: $${formatPrice(entryPriceLimit)}`),
    );
  }

  // Signal Trigger Marker on the last bar
  const triggerElements: string[] = [];
  if (visibleCandles.length > 0) {
    const lastIdx = visibleCandles.length - 1;
    const lastBar = visibleCandles[lastIdx]!;
    const lastX = plotLeft + lastIdx * barStep + barStep / 2;

    // Subtle vertical highlight beam
    triggerElements.push(
      `<rect x="${(lastX - barWidth).toFixed(1)}" y="${plotTop}" width="${(barWidth * 2).toFixed(1)}" height="${plotHeight}" fill="rgba(56, 189, 248, 0.08)"/>`,
    );

    if (direction === 'long') {
      const lowY = toY(lastBar.low) + 8;
      // Triangle pointing up
      const tri = `${lastX.toFixed(1)},${lowY.toFixed(1)} ${(lastX - 7).toFixed(1)},${(lowY + 12).toFixed(1)} ${(lastX + 7).toFixed(1)},${(lowY + 12).toFixed(1)}`;
      triggerElements.push(
        `<polygon points="${tri}" fill="#10b981"/>`,
        `<rect x="${(lastX - 22).toFixed(1)}" y="${(lowY + 14).toFixed(1)}" width="44" height="16" rx="3" fill="#10b981"/>`,
        `<text x="${lastX.toFixed(1)}" y="${(lowY + 25.5).toFixed(1)}" fill="#022c22" font-size="9" font-weight="bold" font-family="sans-serif" text-anchor="middle">▲ BUY</text>`,
      );
    } else {
      const highY = toY(lastBar.high) - 8;
      // Triangle pointing down
      const tri = `${lastX.toFixed(1)},${highY.toFixed(1)} ${(lastX - 7).toFixed(1)},${(highY - 12).toFixed(1)} ${(lastX + 7).toFixed(1)},${(highY - 12).toFixed(1)}`;
      triggerElements.push(
        `<polygon points="${tri}" fill="#ef4444"/>`,
        `<rect x="${(lastX - 24).toFixed(1)}" y="${(highY - 30).toFixed(1)}" width="48" height="16" rx="3" fill="#ef4444"/>`,
        `<text x="${lastX.toFixed(1)}" y="${(highY - 18.5).toFixed(1)}" fill="#450a0a" font-size="9" font-weight="bold" font-family="sans-serif" text-anchor="middle">▼ SELL</text>`,
      );
    }
  }

  // Header Details
  const isLong = direction === 'long';
  const dirColor = isLong ? '#10b981' : '#ef4444';
  const dirBg = isLong ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
  const dirBorder = isLong ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';
  const dirText = isLong ? 'LONG ▲' : 'SHORT ▼';

  const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(rating)))) +
                '☆'.repeat(Math.max(0, 5 - Math.round(rating)));

  const signalTag = signalId ? `sig#${signalId}` : '';

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0b0f19" />
      <stop offset="100%" stop-color="#070a12" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bgGradient)"/>
  
  <!-- Outer Border -->
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#1e293b" stroke-width="1"/>

  <!-- Top Header Bar -->
  <g transform="translate(16, 20)">
    <!-- Symbol -->
    <text x="0" y="24" fill="#f8fafc" font-size="22" font-weight="bold" font-family="sans-serif">${symbol.toUpperCase()}</text>
    
    <!-- Timeframe Pill -->
    <rect x="${symbol.length * 14 + 10}" y="6" width="36" height="22" rx="4" fill="#1e293b" stroke="#334155" stroke-width="1"/>
    <text x="${symbol.length * 14 + 28}" y="21" fill="#94a3b8" font-size="11" font-weight="bold" font-family="monospace" text-anchor="middle">${timeframe.toUpperCase()}</text>

    <!-- Direction Badge -->
    <rect x="${symbol.length * 14 + 54}" y="6" width="76" height="22" rx="4" fill="${dirBg}" stroke="${dirBorder}" stroke-width="1"/>
    <text x="${symbol.length * 14 + 92}" y="21" fill="${dirColor}" font-size="11" font-weight="bold" font-family="sans-serif" text-anchor="middle">${dirText}</text>

    <!-- Strategy Name -->
    <text x="${symbol.length * 14 + 140}" y="21" fill="#94a3b8" font-size="13" font-family="sans-serif">
      ${strategyName.length > 40 ? strategyName.slice(0, 38) + '…' : strategyName}
    </text>

    <!-- Rating & Signal ID (Right-aligned) -->
    <text x="${width - 32}" y="21" fill="#fbbf24" font-size="15" font-family="sans-serif" text-anchor="end">${stars} <tspan fill="#64748b" font-size="11" font-family="monospace">${signalTag}</tspan></text>
  </g>

  <!-- Header Separator Line -->
  <line x1="${plotLeft}" y1="56" x2="${width - 16}" y2="56" stroke="#1e293b" stroke-width="1"/>

  <!-- Plot Area Frame -->
  <rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="#0b0f19" stroke="#1e293b" stroke-width="1"/>

  <!-- Gridlines & Price Labels -->
  ${gridElements.join('\n')}

  <!-- Shaded Risk/Reward Zones -->
  ${zoneElements.join('\n')}

  <!-- Volume Histogram -->
  ${volumeElements.join('\n')}

  <!-- Candlesticks -->
  ${candleElements.join('\n')}

  <!-- Trigger Marker -->
  ${triggerElements.join('\n')}

  <!-- Level Lines & Badges -->
  ${levelElements.join('\n')}

  <!-- Time Axis Labels -->
  ${timeElements.join('\n')}

  <!-- Right Price Axis Border -->
  <line x1="${plotRight}" y1="${plotTop}" x2="${plotRight}" y2="${plotBottom}" stroke="#1e293b" stroke-width="1"/>
</svg>
`.trim();
}

/**
 * Generates a PNG image Buffer from signal parameters.
 */
export async function generateSignalChartPng(params: SignalChartParams): Promise<Buffer> {
  const svg = generateSignalChartSvg(params);
  return sharp(Buffer.from(svg))
    .png({ quality: 90, compressionLevel: 8 })
    .toBuffer();
}
