/**
 * Telegram HTML Message Formatters for alerts, strategy signals,
 * AI evaluations, and market flush digests.
 */

import {
  formatUsdPrice as fmtPrice,
  formatIndicatorValue as fmtValue,
  escapeHtml as esc,
  formatUtc7Timestamp as fmtLocal,
} from '@/lib/format';
import type { OrderEvaluationResult } from '@/lib/ai/evaluator/types';
import type { ChartAnalysis } from '@/lib/ai/types';
import type { DynamicAtrLevels } from '@/types/strategy';

/** Left-pad a label to a fixed column width. */
function lbl(label: string, width: number): string {
  return label.padEnd(width);
}

/** Suffix like "  c2" or "  l3" — omitted when candles <= 1 (default). */
function fmtCheckSuffix(
  mode: 'confirmation' | 'lookback' | undefined,
  candles: number | undefined,
): string {
  const n = candles ?? 1;
  if (n <= 1) return '';
  return `  ${(mode ?? 'confirmation') === 'lookback' ? 'l' : 'c'}${n}`;
}

/**
 * Indicator alert message.
 *
 * 🔔 Indicator Alert
 * Symbol:    BTCUSDT  |  1h
 * Indicator: RSI(14)
 * Trigger:   RSI crossed below 30  →  28.4
 * Price:     $62,840
 * Time:      2026-05-08 14:35 UTC
 */
export function formatAlertMessage(opts: {
  symbol:          string;
  timeframe:       string;
  indicatorName:   string;  // e.g. "RSI(14)" or "Price"
  triggerDesc:     string;  // e.g. "RSI crossed below 30"
  currentValue:    number;  // e.g. 28.4
  price:           number;  // close price of the triggering candle
  timestamp:       number;  // Unix ms of the candle open time
  ruleId?:         string;  // alert_rules.id for debugging
  alertHistoryId?: number;  // alert_history.id for debugging
}): string {
  const {
    symbol, timeframe, indicatorName, triggerDesc,
    currentValue, price, timestamp, ruleId, alertHistoryId,
  } = opts;

  const W = 11; // label column width (longest label is "Indicator:" = 10 + 1 space)
  const lines = [
    '🔔 Indicator Alert',
    `${lbl('Symbol:', W)}${symbol}  |  ${timeframe}`,
    `${lbl('Indicator:', W)}${indicatorName}`,
    `${lbl('Trigger:', W)}${triggerDesc}  →  ${fmtValue(currentValue)}`,
    `${lbl('Price:', W)}${fmtPrice(price)}`,
    `${lbl('Time:', W)}${fmtLocal(timestamp)}`,
  ];

  const refParts: string[] = [];
  if (alertHistoryId != null) refParts.push(`alert#${alertHistoryId}`);
  if (ruleId)                 refParts.push(`rule:${ruleId}`);
  if (refParts.length > 0) {
    lines.push(`${lbl('Ref:', W)}${refParts.join(' · ')}`);
  }

  return `<pre>${lines.map(esc).join('\n')}</pre>`;
}

/**
 * One condition group as passed to the signal message formatter.
 * The group at index 0 is always OR; subsequent groups may be OR or AND.
 */
export interface ConditionGroupDisplay {
  /** Inter-group role: 'or' = alternative setup, 'and' = required filter. */
  groupOperator:     'or' | 'and';
  /** How conditions inside are combined. */
  conditionOperator: 'and' | 'or';
  /** Optional human label for the group. */
  label?:            string;
  /** Structured conditions with pass/fail state, live value, and check metadata. */
  conditions: Array<{
    label:         string;
    passed:        boolean;
    value?:        number;
    checkCandles?: number;
    checkMode?:    'confirmation' | 'lookback';
  }>;
}

/**
 * Strategy signal message — new format with icons, entry price, and
 * only the fired groups shown (highest-scoring first).
 */
export function formatStrategySignalMessage(opts: {
  strategyName:     string;
  longName?:        string;
  /** Per-signal score from signalScore() — 1–7 stars. */
  rating:           number;
  symbol:           string;
  timeframe:        string;
  direction:        'long' | 'short';
  entryPrice:       number;
  /** Limit-order price = entryPrice × 0.97. Omit to hide the Entry line. */
  entryPriceLimit?: number;
  stopLossPct:      number;
  takeProfitPct:    number;
  conditionGroups:  ConditionGroupDisplay[];
  timestamp:        number;
  /** Optional AI order verdict & evaluation snapshot. */
  aiEvaluation?:    OrderEvaluationResult;
  /** Optional DB row ID in strategy_signals for troubleshooting (e.g. sig#482). */
  signalId?:        number;
  /** Optional strategy ID for troubleshooting (e.g. strategy_174...). */
  strategyId?:      string;
  /** Optional strategy version number for troubleshooting. */
  strategyVersion?: number;
  /** Optional dynamic volatility-adjusted ATR levels (Option 5: dual fixed + dynamic). */
  dynamicLevels?:   DynamicAtrLevels;
}): string {
  const {
    strategyName, rating, symbol, timeframe, direction,
    entryPrice, entryPriceLimit, stopLossPct, takeProfitPct,
    conditionGroups, timestamp, aiEvaluation,
    signalId, strategyId, strategyVersion, dynamicLevels,
  } = opts;

  const W        = 9;  // label field width after icon (icon = 1 emoji + 1 space)
  const isLong   = direction === 'long';
  const stars    = '⭐'.repeat(Math.min(7, Math.max(1, rating)));
  const anchor   = entryPriceLimit ?? entryPrice;
  const slPrice  = stopLossPct   > 0 ? anchor * (isLong ? 1 - stopLossPct   / 100 : 1 + stopLossPct   / 100) : null;
  const tpPrice  = takeProfitPct > 0 ? anchor * (isLong ? 1 + takeProfitPct / 100 : 1 - takeProfitPct / 100) : null;

  // ── Header ─────────────────────────────────────────────────────────────────
  const lines: string[] = [
    `📈 "${strategyName}" — ${fmtLocal(timestamp)}`,
    `🏅 ${lbl('Rating:', W)}${stars}`,
    `🪙 ${lbl('Symbol:', W)}${symbol}  |  ${timeframe}`,
    `📡 ${lbl('Signal:', W)}${isLong ? '🟢' : '🔴'} ${isLong ? 'LONG ENTRY' : 'SHORT ENTRY'}`,
    `💵 ${lbl('Price:', W)}${fmtPrice(entryPrice)}`,
  ];

  if (entryPriceLimit != null && Math.abs(entryPriceLimit - entryPrice) > 0.000001) {
    const fixedOffsetPct = Math.abs(((entryPrice - entryPriceLimit) / entryPrice) * 100);
    const fixedEntryPart = `${fmtPrice(entryPriceLimit)} (${isLong ? '-' : '+'}${fixedOffsetPct.toFixed(1)}%)`;
    if (dynamicLevels?.entryPrice != null) {
      lines.push(`🎯 ${lbl('Entry:', W)}${fixedEntryPart} • ${fmtPrice(dynamicLevels.entryPrice)} (0.5×ATR)`);
    } else {
      lines.push(`🎯 ${lbl('Entry:', W)}${fmtPrice(entryPriceLimit)}`);
    }
  } else if (dynamicLevels?.entryPrice != null) {
    lines.push(`🎯 ${lbl('Entry:', W)}${fmtPrice(entryPrice)} (Mkt) • ${fmtPrice(dynamicLevels.entryPrice)} (0.5×ATR)`);
  }

  if (slPrice !== null) {
    const fixedSlPart = `${fmtPrice(slPrice)} (${isLong ? '-' : '+'}${stopLossPct.toFixed(1)}%)`;
    if (dynamicLevels?.stopLossPrice != null) {
      lines.push(`🛡 ${lbl('SL:', W)}${fixedSlPart} • ${fmtPrice(dynamicLevels.stopLossPrice)} (1.5×ATR)`);
    } else {
      lines.push(`🛡 ${lbl('SL:', W)}${fmtPrice(slPrice)}  (${isLong ? '-' : '+'}${stopLossPct.toFixed(1)}%)`);
    }
  } else if (dynamicLevels?.stopLossPrice != null) {
    lines.push(`🛡 ${lbl('SL:', W)}${fmtPrice(dynamicLevels.stopLossPrice)} (1.5×ATR)`);
  }

  if (tpPrice !== null) {
    const fixedTpPart = `${fmtPrice(tpPrice)} (${isLong ? '+' : '-'}${takeProfitPct.toFixed(1)}%)`;
    if (dynamicLevels?.takeProfitPrice != null) {
      lines.push(`🏆 ${lbl('TP:', W)}${fixedTpPart} • ${fmtPrice(dynamicLevels.takeProfitPrice)} (2.5×ATR)`);
    } else {
      lines.push(`🏆 ${lbl('TP:', W)}${fmtPrice(tpPrice)}  (${isLong ? '+' : '-'}${takeProfitPct.toFixed(1)}%)`);
    }
  } else if (dynamicLevels?.takeProfitPrice != null) {
    lines.push(`🏆 ${lbl('TP:', W)}${fmtPrice(dynamicLevels.takeProfitPrice)} (2.5×ATR)`);
  }

  lines.push(`🕯 ${lbl('Candle:', W)}${fmtLocal(timestamp)}`);

  // ── Condition groups ───────────────────────────────────────────────────────
  const orGroups  = conditionGroups.filter((g, i) => i === 0 || g.groupOperator === 'or');
  const andGroups = conditionGroups.filter((g, i) => i  > 0 && g.groupOperator === 'and');

  const groupFired = (g: ConditionGroupDisplay): boolean =>
    g.conditionOperator === 'and'
      ? g.conditions.every((c) => c.passed)
      : g.conditions.some((c) => c.passed);

  const firedOr = orGroups.filter(groupFired);

  function orScore(g: ConditionGroupDisplay): number {
    return g.conditions.filter((c) => c.passed).reduce((s, c) =>
      s + 1 + Math.max(0, (c.checkCandles ?? 1) - 1) * 0.5, 0);
  }

  // Sort highest score first
  const sortedOr = [...firedOr].sort((a, b) => orScore(b) - orScore(a));

  if (sortedOr.length > 0 || andGroups.length > 0) {
    lines.push('');

    for (let gi = 0; gi < sortedOr.length; gi++) {
      const g          = sortedOr[gi]!;
      const condOp     = g.conditionOperator.toUpperCase();
      const groupStars = '⭐'.repeat(Math.min(7, Math.max(1, Math.round(orScore(g)))));

      if (gi > 0) lines.push('── also fired ──');

      // Group label + per-group stars (only when there's a label or multiple groups)
      const hasLabel = !!g.label?.trim();
      if (hasLabel || sortedOr.length > 1) {
        const labelStr = hasLabel ? `[${g.label!.trim()}]` : '';
        lines.push(`  ${labelStr} ${groupStars}`.trimEnd());
      }

      // Only passed conditions; tick at line start
      let firstPassed = true;
      for (const cond of g.conditions) {
        if (!cond.passed) continue;
        const valSuffix   = cond.value !== undefined ? `  →  ${fmtValue(cond.value)}` : '';
        const checkSuffix = fmtCheckSuffix(cond.checkMode, cond.checkCandles);
        const opPrefix    = firstPassed ? '✅    ' : `✅ ${condOp} `;
        lines.push(`${opPrefix}${cond.label}${valSuffix}${checkSuffix}`);
        firstPassed = false;
      }
    }

    for (const g of andGroups) {
      if (!groupFired(g)) continue;        // skip filters that didn't actually pass
      lines.push('── AND filter ──');
      if (g.label?.trim()) lines.push(`  [${g.label.trim()}]`);
      const condOp    = g.conditionOperator.toUpperCase();
      let firstShown  = true;
      for (const cond of g.conditions) {
        if (g.conditionOperator === 'or' && !cond.passed) continue;
        const tick        = cond.passed ? '✅' : '❌';
        const valSuffix   = cond.value !== undefined ? `  →  ${fmtValue(cond.value)}` : '';
        const checkSuffix = fmtCheckSuffix(cond.checkMode, cond.checkCandles);
        const opPrefix    = firstShown ? `${tick}    ` : `${tick} ${condOp} `;
        lines.push(`${opPrefix}${cond.label}${valSuffix}${checkSuffix}`);
        firstShown = false;
      }
    }
  }

  if (aiEvaluation) {
    const icon = aiEvaluation.status === 'PASS' ? '🟢 PASS' : aiEvaluation.status === 'CAVEAT' ? '🟡 CAVEAT' : '🔴 REJECT';
    const scoreStr = aiEvaluation.metrics?.technicalScore !== undefined ? ` • Score: ${aiEvaluation.metrics.technicalScore}/100` : '';
    lines.push('');
    lines.push(`🤖 ${lbl('AI Gatekeeper:', W)}${icon} (${aiEvaluation.confidence.toUpperCase()})${scoreStr}`);
    lines.push(`💡 ${lbl('Decision:', W)}${aiEvaluation.summary}`);

    if (aiEvaluation.analysisSteps) {
      if (aiEvaluation.analysisSteps.trendAndHtfConfluence) {
        lines.push(`🧠 ${lbl('Trend/HTF:', W)}${aiEvaluation.analysisSteps.trendAndHtfConfluence}`);
      }
      if (aiEvaluation.analysisSteps.indicatorAndVolumeFlow) {
        lines.push(`📊 ${lbl('Flow/Deriv:', W)}${aiEvaluation.analysisSteps.indicatorAndVolumeFlow}`);
      }
      if (aiEvaluation.analysisSteps.riskRewardAndVolatility) {
        lines.push(`🛡 ${lbl('ATR Sizing:', W)}${aiEvaluation.analysisSteps.riskRewardAndVolatility}`);
      }
    } else if (aiEvaluation.reasons) {
      if (aiEvaluation.reasons.technical) {
        lines.push(`📊 ${lbl('Technicals:', W)}${aiEvaluation.reasons.technical}`);
      }
      if (aiEvaluation.reasons.primaryRisk) {
        lines.push(`⚠️ ${lbl('Key Risk:', W)}${aiEvaluation.reasons.primaryRisk}`);
      }
    }
  }

  const refParts: string[] = [];
  if (signalId != null) refParts.push(`sig#${signalId}`);
  if (strategyId) {
    refParts.push(strategyVersion != null ? `${strategyId} (v${strategyVersion})` : strategyId);
  }
  if (refParts.length > 0) {
    lines.push('');
    lines.push(`🆔 ${lbl('Ref:', W)}${refParts.join(' · ')}`);
  }

  return `<pre>${lines.map(esc).join('\n')}</pre>`;
}

/**
 * Formats a comprehensive, professional AI Copilot evaluation report
 * ready for delivery via Telegram HTML mode.
 */
export function formatAiEvaluationMessage(opts: {
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  evaluation: OrderEvaluationResult;
  vision?: ChartAnalysis;
}): string {
  const { symbol, timeframe, direction, entryPrice, stopLossPct, takeProfitPct, evaluation, vision } = opts;
  const isLong = direction === 'long';
  const statusIcon = evaluation.status === 'PASS' ? '🟢' : evaluation.status === 'CAVEAT' ? '🟡' : '🔴';
  const statusText =
    evaluation.status === 'PASS'
      ? 'PASS — HIGH CONFLUENCE'
      : evaluation.status === 'CAVEAT'
      ? 'CAVEAT — PROCEED WITH CAUTION'
      : 'REJECT — UNFAVORABLE SETUP';

  const slPrice = stopLossPct != null && stopLossPct > 0
    ? isLong ? entryPrice * (1 - stopLossPct / 100) : entryPrice * (1 + stopLossPct / 100)
    : null;
  const tpPrice = takeProfitPct != null && takeProfitPct > 0
    ? isLong ? entryPrice * (1 + takeProfitPct / 100) : entryPrice * (1 - takeProfitPct / 100)
    : null;

  const lines: string[] = [
    `🤖 <b>AI Order Evaluation — ${esc(symbol)} (${esc(timeframe.toUpperCase())})</b>`,
    '',
    `📡 <b>Setup:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'} @ <b>${fmtPrice(entryPrice)}</b>`,
  ];

  if (slPrice !== null && stopLossPct != null) {
    lines.push(`🛡 <b>SL:</b> ${fmtPrice(slPrice)} (${isLong ? '-' : '+'}${stopLossPct.toFixed(1)}%)`);
  }
  if (tpPrice !== null && takeProfitPct != null) {
    lines.push(`🏆 <b>TP:</b> ${fmtPrice(tpPrice)} (${isLong ? '+' : '-'}${takeProfitPct.toFixed(1)}%)`);
  }

  lines.push(
    `🚦 <b>Verdict:</b> ${statusIcon} <b>${statusText}</b>`,
    `🎯 <b>Confidence:</b> <code>${esc(evaluation.confidence.toUpperCase())}</code>`,
    `🧠 <b>Engine:</b> <code>${esc(evaluation.model.modelName)}</code>`,
    '',
    `📋 <b>Executive Summary:</b>`,
    `<i>${esc(evaluation.summary)}</i>`
  );

  // Vision trend & bias
  if (vision) {
    lines.push('');
    lines.push(`📈 <b>Visual Trend & Bias:</b>`);
    lines.push(`• Bias: <b>${esc(vision.bias.toUpperCase())}</b> · Trend: <b>${esc(vision.trend.direction.toUpperCase())}</b> (${esc(vision.trend.strength)})`);
    if (vision.trend.summary) {
      lines.push(`<i>${esc(vision.trend.summary)}</i>`);
    }

    if (vision.key_levels && vision.key_levels.length > 0) {
      lines.push('');
      lines.push(`🎯 <b>Key Levels (Vision):</b>`);
      for (const lvl of vision.key_levels.slice(0, 4)) {
        const badge = lvl.type === 'support' ? '🟢 SUP' : '🔴 RES';
        const noteText = lvl.notes ? `: ${esc(lvl.notes)}` : '';
        lines.push(`• <b>${badge}</b> <code>${fmtPrice(lvl.price)}</code>${noteText}`);
      }
    }

    if (vision.trade_setup) {
      const ts = vision.trade_setup;
      const actionBadge = ts.action === 'long' ? '🟢 LONG' : ts.action === 'short' ? '🔴 SHORT' : '⚪ WAIT';
      lines.push('');
      lines.push(`💡 <b>AI Suggested Trade Plan:</b>`);
      lines.push(`• Setup: <b>${actionBadge}</b> @ <code>${fmtPrice(ts.entry_price)}</code> (${esc(ts.entry_type)})`);
      lines.push(`• Stop Loss: <code>${fmtPrice(ts.stop_loss)}</code> (${ts.stop_loss_pct.toFixed(1)}%)`);
      lines.push(`• Take Profit: <code>${fmtPrice(ts.take_profit)}</code> (${ts.take_profit_pct.toFixed(1)}%) · R:R: <b>${esc(ts.risk_reward_ratio)}</b>`);
      if (ts.entry_rationale) lines.push(`• Entry rationale: <i>${esc(ts.entry_rationale)}</i>`);
      if (ts.stop_loss_rationale) lines.push(`• Invalidation: <i>${esc(ts.stop_loss_rationale)}</i>`);
    }
  }

  // Confluence & Alignment
  lines.push('');
  lines.push(`📊 <b>Confluence Analysis:</b>`);
  lines.push(`• <b>Technical Alignment (${evaluation.metrics.technicalScore}/100):</b>`);
  lines.push(`  ${esc(evaluation.reasons.technical)}`);

  const sentSign = evaluation.metrics.sentimentScore > 0 ? '+' : '';
  lines.push(`• <b>Sentiment (${sentSign}${evaluation.metrics.sentimentScore}):</b>`);
  lines.push(`  ${esc(evaluation.reasons.sentiment)}`);

  // Risk & Invalidation
  if (evaluation.reasons.primaryRisk) {
    lines.push('');
    lines.push(`⚠️ <b>Key Risk & Invalidation:</b>`);
    lines.push(`<i>${esc(evaluation.reasons.primaryRisk)}</i>`);
  }

  lines.push('');
  lines.push(`🕒 <code>${fmtLocal(Date.now())}</code> • <i>RMC AI Copilot</i>`);

  return lines.join('\n');
}

/**
 * Format Option E Market Flush consolidated digest.
 */
export function formatMarketFlushMessage(opts: {
  signals: Array<{
    strategyName: string;
    symbol: string;
    timeframe: string;
    direction: 'long' | 'short';
    entryPrice: number;
    rating: number;
    signalId?: number;
    strategyId?: string;
  }>;
  macroEvaluation: import('@/lib/ai/evaluator/macro').MacroMarketEvaluation;
  timestamp: number;
}): string {
  const { signals, macroEvaluation, timestamp } = opts;
  const longCount = signals.filter((s) => s.direction === 'long').length;
  const shortCount = signals.filter((s) => s.direction === 'short').length;

  const verdictEmoji =
    macroEvaluation.verdict === 'PASS'
      ? '🟢 PASS'
      : macroEvaluation.verdict === 'CAVEAT'
      ? '🟡 CAVEAT'
      : '🔴 REJECT';

  const lines: string[] = [
    `🚨 <b>MARKET FLUSH DETECTED (${signals.length} Signals Fired)</b>`,
    `🕯 <b>Time:</b> ${fmtLocal(timestamp)} | <b>Breakdown:</b> ${longCount} Long / ${shortCount} Short`,
    '',
    `📋 <b>Triggered Strategies:</b>`,
  ];

  for (const s of signals) {
    const isLong = s.direction === 'long';
    const stars = '⭐'.repeat(Math.min(7, Math.max(1, s.rating)));
    const idMeta = [
      s.signalId != null ? `sig#${s.signalId}` : null,
      s.strategyId ? s.strategyId : null,
    ].filter(Boolean).join(' · ');
    const metaSuffix = idMeta ? ` <code>[${esc(idMeta)}]</code>` : '';
    lines.push(
      `• <b>${s.symbol}</b> (${s.timeframe}): ${isLong ? '🟢 LONG' : '🔴 SHORT'} @ $${s.entryPrice.toLocaleString('en-US')} | ${stars} ("${s.strategyName}")${metaSuffix}`
    );
  }

  lines.push('');
  lines.push(`🧠 <b>AI Macro Assessment:</b> ${verdictEmoji} (${macroEvaluation.confidence.toUpperCase()})`);
  lines.push(`💡 <i>${macroEvaluation.summary}</i>`);

  if (macroEvaluation.correlationContext) {
    lines.push(`📊 <b>Correlation:</b> ${macroEvaluation.correlationContext}`);
  }

  if (macroEvaluation.keyRisks && macroEvaluation.keyRisks.length > 0) {
    lines.push(`⚠️ <b>Key Risks:</b> ${macroEvaluation.keyRisks.join(' • ')}`);
  }

  if (macroEvaluation.recommendedAction) {
    lines.push(`🎯 <b>Action:</b> ${macroEvaluation.recommendedAction}`);
  }

  return lines.join('\n');
}
