/**
 * Phase 3 — AI chart analysis types.
 *
 * ChartAnalysis is the canonical shape returned by Gemini and stored in the
 * ai_chart_analysis DB cache table.  All consumers (API route, AnalysisPanel)
 * import from here.
 */

export type TrendDirection = 'bullish' | 'bearish' | 'sideways';
export type TrendStrength  = 'strong'  | 'moderate' | 'weak';
export type LevelType      = 'support' | 'resistance';
export type PatternConfidence = 'high' | 'medium' | 'low';
export type Bias           = 'long' | 'short' | 'neutral';

export interface KeyLevel {
  type:  LevelType;
  price: number;
  notes: string;
}

export interface ChartPattern {
  name:        string;
  confidence:  PatternConfidence;
  description: string;
}

export interface TradeSetupRecommendation {
  action: 'long' | 'short' | 'wait';
  entry_price: number;
  entry_type: 'market' | 'pullback' | 'breakout';
  entry_rationale: string;
  stop_loss: number;
  stop_loss_pct: number;
  stop_loss_rationale: string;
  take_profit: number;
  take_profit_pct: number;
  take_profit_rationale: string;
  risk_reward_ratio: string;
}

export interface ChartAnalysis {
  trend: {
    direction: TrendDirection;
    strength:  TrendStrength;
    summary:   string;
  };
  key_levels:  KeyLevel[];
  patterns:    ChartPattern[];
  risk_notes:  string[];
  bias:        Bias;
  trade_setup?: TradeSetupRecommendation;
  /** Always injected by the server — never trust model to include it. */
  disclaimer:  string;
}

/** API route request body. */
export interface AnalyzeChartRequest {
  /** Base64-encoded PNG (no data-URL prefix). */
  imageBase64:    string;
  symbol:         string;
  timeframe:      string;
  /** Unix ms of the last closed candle — used as the cache key. */
  lastCandleTime: number;
  /** When true, bypasses the database cache and forces a fresh inspection. */
  forceRefresh?:  boolean;
}

/** API route response (success path). */
export interface AnalyzeChartResponse {
  analysis:  ChartAnalysis;
  fromCache: boolean;
  cachedAt?: string; // ISO 8601
  model:     string;
}
