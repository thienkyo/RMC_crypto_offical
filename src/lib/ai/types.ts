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
}

/** API route response (success path). */
export interface AnalyzeChartResponse {
  analysis:  ChartAnalysis;
  fromCache: boolean;
  cachedAt?: string; // ISO 8601
  model:     string;
}
