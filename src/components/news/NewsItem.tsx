'use client';

/**
 * NewsItem — single article card in the news feed.
 *
 * Shows: source badge · title (linked) · author · relative time · sentiment badge
 * If a Claude summary exists, it replaces the body excerpt.
 */

import { formatDistanceToNow } from 'date-fns';
import { SentimentBadge } from './SentimentBadge';
import type { NewsArticle } from '@/types/news';

/** Credibility → dot color */
function CredDot({ credibility }: { credibility: number }) {
  const color =
    credibility >= 0.9 ? 'bg-up' :
    credibility >= 0.7 ? 'bg-yellow-400' :
    'bg-text-muted';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${color}`} title={`Credibility ${credibility}`} />;
}

interface Props {
  article: NewsArticle;
}

export function NewsItem({ article }: Props) {
  const relativeTime = formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true });
  const excerpt      = article.sentimentSummary ?? article.body ?? null;

  return (
    <article className="flex flex-col gap-1.5 py-2.5 border-b border-surface-border last:border-b-0">
      {/* Source + time row */}
      <div className="flex items-center gap-1.5">
        <CredDot credibility={article.credibility} />
        <span className="text-[10px] font-mono uppercase tracking-wide text-text-muted">
          {article.source}
        </span>
        {article.author && (
          <>
            <span className="text-[10px] text-surface-border">·</span>
            <span className="text-[10px] text-text-muted truncate max-w-[80px]">{article.author}</span>
          </>
        )}
        <span className="text-[10px] text-surface-border ml-auto flex-shrink-0">·</span>
        <span className="text-[10px] text-text-muted flex-shrink-0">{relativeTime}</span>
      </div>

      {/* Title */}
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[12px] font-medium text-text-primary leading-snug hover:text-accent transition-colors line-clamp-2"
      >
        {article.title}
      </a>

      {/* Excerpt (Claude summary or body snippet) */}
      {excerpt && (
        <p className="text-[11px] text-text-muted leading-relaxed line-clamp-2">
          {excerpt}
        </p>
      )}

      {/* Sentiment badge — only when classified */}
      {article.sentimentScore !== null && article.sentimentLabel && (
        <div>
          <SentimentBadge score={article.sentimentScore} label={article.sentimentLabel} />
        </div>
      )}
    </article>
  );
}
