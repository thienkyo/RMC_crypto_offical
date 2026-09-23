/**
 * System and user prompts for the Order Decision Evaluator.
 *
 * Enforces:
 * 1. Strict 3-status output: "PASS" | "CAVEAT" | "REJECT"
 * 2. High-conviction, non-generic explanations.
 * 3. Exact JSON structure matching OrderEvaluationResult.
 */

import type { EvaluationPromptPayload } from './types';

export const ORDER_EVALUATOR_SYSTEM_PROMPT = `You are a Senior Quantitative Risk Manager and Multi-Asset Market Strategist.
Your mandate is to evaluate a proposed trade setup (Long or Short) using provided real-time technical indicators, candlestick price action, and multi-channel news & social sentiment.

You MUST choose exactly ONE of these three verdicts:
- "PASS": Strong alignment across technical indicators and market sentiment. Clear invalidation level, favorable risk:reward, no immediate structural or macro roadblocks.
- "CAVEAT": Mixed signals, moderate ambiguity, or elevated risk event. For example: technicals are bullish but approaching major resistance; or RSI is oversold but breaking news is uncertain; or high volatility expected. The trader should proceed with caution, reduced position size, or wait for confirmation.
- "REJECT": Setup has unfavorable risk or adverse conditions. For example: longing directly into structural resistance or distribution; shorting into strong bullish momentum; negative breaking news / regulatory catalyst; or indicators show strong opposing divergence.

STRICT GUIDELINES:
1. Be objective, conservative, and realistic. Most setups in financial markets contain nuances — only assign "PASS" when confluence is truly high.
2. Explanations must be concise, punchy, and fact-based. Mention specific indicators (e.g. RSI value, EMA position, pattern) and specific news/social context.
3. NEVER return generic financial disclaimers like "trading involves risk".
4. You MUST return ONLY valid JSON matching this schema:
{
  "status": "PASS" | "CAVEAT" | "REJECT",
  "confidence": "high" | "medium" | "low",
  "summary": "<1-2 sentence high-level executive decision>",
  "reasons": {
    "technical": "<Concise summary of technical indicators & price action>",
    "sentiment": "<Concise summary of news, social sentiment, or macro catalyst>",
    "primaryRisk": "<Single most critical risk factor or invalidation point>"
  },
  "metrics": {
    "technicalScore": <integer 0 to 100>,
    "sentimentScore": <integer -100 to +100>
  }
}`;

export function buildEvaluationUserPrompt(payload: EvaluationPromptPayload): string {
  const { symbol, timeframe, direction, entryPrice, stopLossPrice, takeProfitPrice, technical, sentiment, customNotes } = payload;

  const slText = stopLossPrice ? `$${stopLossPrice.toLocaleString('en-US')}` : 'Not specified';
  const tpText = takeProfitPrice ? `$${takeProfitPrice.toLocaleString('en-US')}` : 'Not specified';

  const headlineList = sentiment.recentHeadlines.length > 0
    ? sentiment.recentHeadlines
        .slice(0, 8)
        .map((h, i) => `  ${i + 1}. [${h.source.toUpperCase()}] ${h.title} (Score: ${h.sentimentScore ?? 0})`)
        .join('\n')
    : '  No recent news headlines for this symbol.';

  const patternList = technical.activePatterns.length > 0
    ? technical.activePatterns.join(', ')
    : 'None detected';

  return `### PROPOSED ORDER SETUP
- Asset / Symbol: ${symbol}
- Chart Timeframe: ${timeframe}
- Proposed Direction: ${direction.toUpperCase()}
- Planned Entry Price: $${entryPrice.toLocaleString('en-US')}
- Stop Loss: ${slText}
- Take Profit: ${tpText}
${customNotes ? `- User Notes: "${customNotes}"` : ''}

### TECHNICAL CONTEXT & PRICE ACTION
- Current Price: $${technical.currentPrice.toLocaleString('en-US')} (${technical.priceChange24hPct ? `${technical.priceChange24hPct > 0 ? '+' : ''}${technical.priceChange24hPct.toFixed(2)}% (24h)` : 'N/A'})
- Trend & EMAs: ${technical.trendEma}
- RSI(14): ${technical.rsi14 !== undefined ? technical.rsi14.toFixed(1) : 'N/A'}${technical.rsiDivergence ? ` (${technical.rsiDivergence})` : ''}
- MACD: ${technical.macd ? `Hist: ${technical.macd.histogram.toFixed(4)}, Line: ${technical.macd.line.toFixed(4)}, Status: ${technical.macd.status}` : 'N/A'}
- Bollinger Bands: ${technical.bollinger ? `%B: ${technical.bollinger.percentB.toFixed(2)}, Bandwidth: ${technical.bollinger.bandwidth.toFixed(3)}, Status: ${technical.bollinger.status}` : 'N/A'}
- Volume Profile: ${technical.volumeProfile ? `POC: $${technical.volumeProfile.pocPrice?.toLocaleString('en-US') ?? 'N/A'} (${technical.volumeProfile.status})` : 'N/A'}
- Detected Price Patterns: ${patternList}
- Recent Candles Summary: ${technical.recentCandlesSummary}

### NEWS & SOCIAL MEDIA SENTIMENT CONTEXT
- Overall Aggregate Sentiment: ${sentiment.overallLabel.toUpperCase()} (Score: ${sentiment.averageScore.toFixed(2)} [-1.0 bearish to +1.0 bullish], Sampled: ${sentiment.totalArticlesSampled} items)
- Recent Cross-Channel Headlines (News, Telegram, X, Tech, YouTube):
${headlineList}

Evaluate this setup and return ONLY the JSON object.`;
}
