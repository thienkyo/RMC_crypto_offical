import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { NewsArticle } from '@/types/news';

interface CustomNewsResponse {
  articles: NewsArticle[];
  error?: string;
}

export function useCustomNews(): UseQueryResult<NewsArticle[]> {
  return useQuery<NewsArticle[]>({
    queryKey: ['news-custom'],
    queryFn: async () => {
      const res = await fetch('/api/news/custom');
      if (!res.ok) {
        throw new Error(`Failed to load custom news (HTTP ${res.status})`);
      }
      const data = (await res.json()) as CustomNewsResponse;
      return data.articles ?? [];
    },
    staleTime:       60_000,
    refetchInterval: 60_000,
  });
}
