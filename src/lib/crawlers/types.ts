/**
 * Shared crawler contract.
 *
 * Every source (RSS, Reddit, Nitter, Polymarket) implements Crawler and
 * returns RawArticle[]. The persist layer handles dedup + symbol tagging.
 */

export interface RawArticle {
  /** Source identifier — matches the `source` column in news_articles. */
  source:      string;
  /**
   * Dedup key — must be stable across multiple fetches of the same content.
   * For RSS: SHA-1 of the canonical URL. For Reddit: post `id`. For Nitter: tweet id.
   */
  externalId:  string;
  url:         string;
  title:       string;
  /** First ~500 chars of body text. Never raw HTML. */
  body?:       string;
  author?:     string;
  publishedAt: Date;
}

export interface Crawler {
  readonly name: string;
  fetch(): Promise<RawArticle[]>;
}

/** Source credibility weights — higher = more trustworthy in sentiment aggregation. */
export const SOURCE_CREDIBILITY: Record<string, number> = {
  coindesk:      1.0,
  theblock:      1.0,
  cointelegraph: 0.9,
  decrypt:       0.9,
  beincrypto:    0.8,
  cryptopanic:   0.7,
  reddit:        0.6,
  nitter:        0.5,
  polymarket:    0.9, // prediction markets are strong signals
};
