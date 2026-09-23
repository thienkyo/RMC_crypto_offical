/**
 * Types for the Multi-LLM Order Decision Evaluator.
 *
 * Enforces a strict 3-status verdict: PASS / CAVEAT / REJECT
 * along with concise, structured rationale.
 */

export type EvaluationStatus = 'PASS' | 'CAVEAT' | 'REJECT';
export type EvaluatorProvider = 'claude' | 'chatgpt' | 'gemini' | 'ensemble';

export const LATEST_MODELS = {
  claude: {
    default: 'claude-opus-5-1',
    options: [
      { id: 'claude-opus-5-1',            label: 'Claude Opus 5.1 (Latest Frontier Flagship)' },
      { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
      { id: 'claude-fable-5-1',           label: 'Claude Fable 5.1 (Agentic Fast)' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet v2' },
      { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku (Fast)' },
    ],
  },
  chatgpt: {
    default: 'gpt-5.1',
    options: [
      { id: 'gpt-5.1',          label: 'ChatGPT 5.1 (Latest Flagship)' },
      { id: 'gpt-6-astra',      label: 'OpenAI GPT-6 Astra (Frontier SOTA)' },
      { id: 'gpt-6-sol',        label: 'OpenAI GPT-6 Sol (Cost-Efficient Flagship)' },
      { id: 'o4-mini',          label: 'OpenAI o4-mini (Deliberative Reasoning)' },
      { id: 'gpt-4o',           label: 'ChatGPT GPT-4o (Omni Standard)' },
      { id: 'o3-mini',          label: 'OpenAI o3-mini (High-Speed Reasoning)' },
    ],
  },
  gemini: {
    default: 'gemini-3.8-flash',
    options: [
      { id: 'gemini-3.8-flash', label: 'Google Gemini 3.8 Flash (Latest Workhorse Flagship)' },
      { id: 'gemini-3.8-live',  label: 'Google Gemini 3.8 Live (Extended Thinking)' },
      { id: 'gemini-2.5-flash', label: 'Google Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro',   label: 'Google Gemini 2.5 Pro (Deep Reasoning)' },
      { id: 'gemini-2.0-flash', label: 'Google Gemini 2.0 Flash' },
    ],
  },
} as const;

export interface OrderEvaluationRequest {
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  /** Unix ms timestamp of the reference candle (used as cache key). */
  candleTime: number;
  provider?: EvaluatorProvider;
  customNotes?: string;
}

export interface EvaluationReasons {
  /** Technical indicators & price action confluence or flaw. */
  technical: string;
  /** News, social media, or macro catalyst. */
  sentiment: string;
  /** Key invalidation level or primary risk factor. */
  primaryRisk: string;
}

export interface EvaluationMetrics {
  /** 0 to 100 estimated technical alignment score. */
  technicalScore: number;
  /** -100 to +100 overall sentiment score (-100 bearish to +100 bullish). */
  sentimentScore: number;
}

export interface EnsembleVote {
  status: EvaluationStatus;
  reason: string;
}

export interface OrderEvaluationResult {
  status: EvaluationStatus;
  confidence: 'high' | 'medium' | 'low';
  /** Exactly 1-2 sentence high-level summary. */
  summary: string;
  reasons: EvaluationReasons;
  metrics: EvaluationMetrics;
  model: {
    provider: EvaluatorProvider;
    modelName: string;
    ensembleVotes?: Record<string, EnsembleVote>;
  };
  fromCache?: boolean;
  evaluatedAt: string; // ISO 8601
}

export interface TechnicalSnapshot {
  currentPrice: number;
  priceChange24hPct?: number;
  trendEma: string; // e.g. "Price > EMA20 > EMA50 > EMA200 (Strong Bullish)"
  rsi14?: number;
  rsiDivergence?: string;
  macd?: {
    line: number;
    signal: number;
    histogram: number;
    status: string; // e.g. "Bullish cross above zero"
  };
  bollinger?: {
    percentB: number;
    bandwidth: number;
    status: string;
  };
  volumeProfile?: {
    pocPrice?: number;
    status: string;
  };
  activePatterns: string[];
  recentCandlesSummary: string;
}

export interface SentimentSnapshot {
  averageScore: number; // -1.0 to +1.0
  overallLabel: 'bullish' | 'neutral' | 'bearish';
  totalArticlesSampled: number;
  recentHeadlines: Array<{
    source: string;
    title: string;
    publishedAt: string;
    sentimentScore?: number;
  }>;
}

export interface EvaluationPromptPayload {
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  technical: TechnicalSnapshot;
  sentiment: SentimentSnapshot;
  customNotes?: string;
}

/**
 * Converts a dollar amount spend limit per evaluation into max output tokens.
 * Benchmark: Frontier reasoning models output cost ~$10 per 1M tokens ($0.00001 per token).
 * e.g., $0.005 -> 500 tokens, $0.01 -> 1,000 tokens, $0.02 -> 2,000 tokens.
 * Clamped between 256 and 8,192 tokens.
 */
export function costToMaxTokens(costUsd: number): number {
  if (isNaN(costUsd) || costUsd <= 0) return 1024;
  const tokens = Math.round(costUsd * 100_000);
  return Math.max(256, Math.min(8192, tokens));
}

/**
 * Converts max tokens back to approximate cost in USD.
 */
export function maxTokensToCost(tokens: number): number {
  if (isNaN(tokens) || tokens <= 0) return 0.01;
  return Number((tokens / 100_000).toFixed(4));
}
