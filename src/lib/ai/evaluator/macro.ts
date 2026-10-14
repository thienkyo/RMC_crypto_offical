/**
 * Macro Market Flush Evaluator.
 *
 * When multiple crypto strategy signals (>= 3) fire simultaneously due to a
 * broad market sell-off or rally, this evaluator performs a single high-level
 * correlation analysis rather than running 20 isolated token-heavy LLM calls.
 */

import { getAiKey, getAiModel } from '@/lib/db/aiSettings';

export interface FiredSignalSummary {
  strategyName: string;
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entryPrice: number;
  rating: number;
}

export interface MacroMarketEvaluation {
  verdict: 'PASS' | 'CAVEAT' | 'REJECT';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  correlationContext: string;
  keyRisks: string[];
  recommendedAction: string;
}

const MACRO_SYSTEM_PROMPT = `You are a Senior Crypto Risk & Portfolio Risk Officer.
When a sudden market wave or crash occurs, multiple technical strategies trigger signals at the same time across different symbols (e.g. BTC, ETH, SOL, PAXG).
Your job is to provide a unified Macro Assessment of this cluster of signals.

You must evaluate:
1. Market Correlation: Is this a cascade liquidation / market flush, or a genuine broad accumulation?
2. Alignment: Are strategies aligned in direction (e.g., all Longs attempting to catch a falling knife, or mixed Long/Short)?
3. Risk & Danger: Is there high knife-catching risk? High volatility?
4. Verdict:
   - PASS: Strong structural support, clear confluence, favorable risk/reward.
   - CAVEAT: High volatility / knife-catch danger. Advise waiting for candle close or partial sizing.
   - REJECT: Cascading sell-off, high liquidation risk, fake bounce.
5. Recommended Action: 1-2 practical sentences for portfolio management.

Respond strictly in valid JSON matching this schema:
{
  "verdict": "PASS" | "CAVEAT" | "REJECT",
  "confidence": "high" | "medium" | "low",
  "summary": "Brief 1-2 sentence overview of the market wave",
  "correlationContext": "Explain how BTC and altcoins are reacting together",
  "keyRisks": ["Risk 1", "Risk 2"],
  "recommendedAction": "Actionable advice for the trader"
}`;

export async function evaluateMarketFlush(
  signals: FiredSignalSummary[],
  candleTime: number,
): Promise<MacroMarketEvaluation> {
  const apiKey = (await getAiKey('gemini')) || (await getAiKey('chatgpt')) || (await getAiKey('claude'));
  if (!apiKey) {
    return {
      verdict: 'CAVEAT',
      confidence: 'medium',
      summary: `Cluster of ${signals.length} signals triggered simultaneously during high market volatility.`,
      correlationContext: 'Multiple assets triggered entry conditions concurrently.',
      keyRisks: ['Market-wide correlation risk', 'Cascading volatility'],
      recommendedAction: 'Verify higher-timeframe candle close before entering simultaneous positions.',
    };
  }

  const symbols = Array.from(new Set(signals.map((s) => s.symbol))).join(', ');
  const longCount = signals.filter((s) => s.direction === 'long').length;
  const shortCount = signals.filter((s) => s.direction === 'short').length;

  const signalsTable = signals
    .map((s) => `- ${s.symbol} (${s.timeframe}): ${s.direction.toUpperCase()} | Entry ~$${s.entryPrice} | ${'⭐'.repeat(Math.min(7, Math.max(1, s.rating)))} ("${s.strategyName}")`)
    .join('\n');

  const userPrompt = `A market wave triggered ${signals.length} strategy signals simultaneously:
Time: ${new Date(candleTime).toISOString()}
Symbols: ${symbols}
Directional breakdown: ${longCount} Longs, ${shortCount} Shorts

Triggered Strategies:
${signalsTable}

Provide a concise macro evaluation of this simultaneous signal cluster in the required JSON format.`;

  try {
    const geminiKey = await getAiKey('gemini');
    if (geminiKey) {
      const model = await getAiModel('gemini');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: MACRO_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          return {
            verdict: ['PASS', 'CAVEAT', 'REJECT'].includes(parsed.verdict) ? parsed.verdict : 'CAVEAT',
            confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
            summary: parsed.summary || 'Simultaneous market flush detected.',
            correlationContext: parsed.correlationContext || '',
            keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks : ['Correlation flush risk'],
            recommendedAction: parsed.recommendedAction || 'Manage risk cautiously.',
          };
        }
      }
    }
  } catch (err) {
    console.warn('[macroEvaluator] LLM evaluation error, using fallback:', err);
  }

  // Fallback if LLM unavailable
  return {
    verdict: 'CAVEAT',
    confidence: 'medium',
    summary: `Market Flush: ${signals.length} strategies triggered concurrently (${longCount} Long / ${shortCount} Short).`,
    correlationContext: 'Broad market move caused correlated technical triggers across assets.',
    keyRisks: ['Knife-catch hazard on sharp dips', 'Correlated drawdowns'],
    recommendedAction: 'Consider taking only the single highest-rated setup or waiting for candle confirmation.',
  };
}
