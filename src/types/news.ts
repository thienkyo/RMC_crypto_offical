/**
 * Shared types for Phase 4 news & sentiment pipeline.
 * Used by crawlers, sentiment lib, API routes, and UI components.
 */

export type SentimentLabel = 'bearish' | 'neutral' | 'bullish';

export interface NewsArticle {
  id:               string;
  source:           string;
  externalId:       string;
  url:              string;
  title:            string;
  body:             string | null;
  author:           string | null;
  publishedAt:      string; // ISO 8601
  fetchedAt:        string;
  symbols:          string[];
  sentimentScore:   number | null;  // -1.0 → +1.0
  sentimentLabel:   SentimentLabel | null;
  sentimentSummary: string | null;
  sentimentModel:   string | null;
  credibility:      number;
}

export interface NewsFeedAggregate {
  score:        number;    // credibility-weighted mean of recent scores
  label:        SentimentLabel;
  articleCount: number;
  window:       '1h' | '24h';
}

export interface NewsFeedResponse {
  articles:  NewsArticle[];
  aggregate: NewsFeedAggregate | null;
}

export interface NewsDigestResponse {
  digest:       string;
  articleCount: number;
  generatedAt:  string; // ISO 8601 — cached for 30 min
  fromCache:    boolean;
}

export interface PolymarketSnapshot {
  id:        string;
  marketId:  string;
  question:  string;
  symbols:   string[];
  yesProb:   number;
  noProb:    number;
  fetchedAt: string;
}

export interface NitterAccount {
  handle:      string;
  displayName: string | null;
  symbols:     string[];
  active:      boolean;
}
