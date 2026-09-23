'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomNewsFeed, CustomFeedsResponse, TestFeedResult } from '@/types/news';

export function CustomFeedsSection() {
  const queryClient = useQueryClient();

  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [testResult, setTestResult] = useState<TestFeedResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [rowTestingId, setRowTestingId] = useState<string | null>(null);
  const [rowTestResults, setRowTestResults] = useState<Record<string, TestFeedResult>>({});

  // Query all configured feeds
  const { data, isLoading } = useQuery<CustomNewsFeed[]>({
    queryKey: ['custom-feeds'],
    queryFn: async () => {
      const res = await fetch('/api/news/custom-feeds');
      if (!res.ok) throw new Error('Failed to load custom feeds');
      const json = (await res.json()) as CustomFeedsResponse;
      return json.feeds ?? [];
    },
  });

  // Add mutation
  const addMutation = useMutation({
    mutationFn: async (feed: { name: string; url: string; resolvedFeedUrl?: string | null; mode?: string }) => {
      const res = await fetch('/api/news/custom-feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feed),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to add feed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-feeds'] });
      setNewUrl('');
      setNewName('');
      setTestResult(null);
    },
  });

  // Toggle active mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await fetch(`/api/news/custom-feeds/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error('Failed to update feed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-feeds'] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/news/custom-feeds/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete feed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-feeds'] });
    },
  });

  // Test new feed before adding
  const handleTestNew = async () => {
    const url = newUrl.trim();
    if (!url) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/news/custom-feeds/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const result = (await res.json()) as TestFeedResult;
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setIsTesting(false);
    }
  };

  // Test existing feed row
  const handleTestRow = async (feed: CustomNewsFeed) => {
    setRowTestingId(feed.id);
    try {
      const res = await fetch('/api/news/custom-feeds/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feed.resolvedFeedUrl || feed.url }),
      });
      const result = (await res.json()) as TestFeedResult;
      setRowTestResults((prev) => ({ ...prev, [feed.id]: result }));
    } catch (err) {
      setRowTestResults((prev) => ({
        ...prev,
        [feed.id]: { ok: false, error: err instanceof Error ? err.message : 'Network error' },
      }));
    } finally {
      setRowTestingId(null);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    addMutation.mutate({
      name: newName.trim(),
      url: newUrl.trim(),
      resolvedFeedUrl: testResult?.ok ? newUrl.trim() : null,
      mode: testResult?.mode || 'rss',
    });
  };

  const feeds = data ?? [];

  return (
    <div className="mt-8 border-t border-surface-border pt-8">
      {/* ── Section header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-text-primary tracking-wide mb-1">
            Custom News Sources
          </h2>
          <p className="text-xs text-text-secondary">
            Personal RSS/Atom feeds, blogs, or tech publications for the right rail. Capped at 4 latest articles per feed.
          </p>
        </div>
        <span className="text-[10px] font-mono text-text-muted bg-surface-2 px-2 py-0.5 rounded border border-surface-border">
          {feeds.filter((f) => f.active).length} Active
        </span>
      </div>

      {/* ── Feeds list ── */}
      <div className="border border-surface-border rounded-lg overflow-hidden bg-surface-1 mb-4">
        {isLoading ? (
          <div className="p-4 text-xs font-mono text-text-muted">Loading custom sources…</div>
        ) : feeds.length === 0 ? (
          <div className="p-4 text-xs font-mono text-text-muted">No custom feeds configured. Add one below.</div>
        ) : (
          <div className="divide-y divide-surface-border">
            {feeds.map((feed) => {
              const rowTest = rowTestResults[feed.id];
              const isTestingThisRow = rowTestingId === feed.id;

              return (
                <div key={feed.id} className="p-3 flex flex-col gap-1.5 hover:bg-surface-2/40 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-text-primary truncate">
                          {feed.name}
                        </span>
                        <span className="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-surface-3 text-text-muted border border-surface-border">
                          {feed.mode}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-text-muted truncate" title={feed.url}>
                        {feed.url}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Test button */}
                      <button
                        type="button"
                        onClick={() => handleTestRow(feed)}
                        disabled={isTestingThisRow}
                        className="text-[10px] font-mono px-2 py-1 rounded bg-surface-3 text-text-secondary
                                   hover:text-text-primary hover:bg-surface-border disabled:opacity-50 transition-colors"
                      >
                        {isTestingThisRow ? 'Testing…' : 'Test'}
                      </button>

                      {/* Active toggle */}
                      <button
                        type="button"
                        onClick={() => toggleMutation.mutate({ id: feed.id, active: !feed.active })}
                        className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                          feed.active
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                            : 'bg-surface-3 text-text-muted border-surface-border hover:text-text-primary'
                        }`}
                      >
                        {feed.active ? 'Active' : 'Paused'}
                      </button>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(feed.id)}
                        title="Remove custom feed"
                        className="w-6 h-6 flex items-center justify-center rounded text-text-muted
                                   hover:text-red-400 hover:bg-red-400/10 transition-colors text-sm"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Inline test result */}
                  {rowTest && (
                    <div className="text-[10px] font-mono pl-1">
                      {rowTest.ok ? (
                        <div className="text-emerald-400 flex items-center gap-2">
                          <span>✓ {rowTest.mode?.toUpperCase()} OK ({rowTest.itemCount} items)</span>
                          {rowTest.sampleTitles && rowTest.sampleTitles.length > 0 && (
                            <span className="text-text-muted truncate max-w-sm">
                              Sample: &quot;{rowTest.sampleTitles[0]}&quot;
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-red-400">✗ {rowTest.error}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add new feed form ── */}
      <form onSubmit={handleAddSubmit} className="p-3 border border-surface-border rounded-lg bg-surface-2 flex flex-col gap-2">
        <span className="text-[11px] font-mono font-semibold text-text-secondary">
          + Add New Feed or Blog
        </span>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Name (e.g. SemiAnalysis)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="sm:w-44 px-2 py-1 rounded bg-surface-3 border border-surface-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <input
            type="url"
            placeholder="https://... (RSS feed or site homepage)"
            value={newUrl}
            onChange={(e) => {
              setNewUrl(e.target.value);
              setTestResult(null);
            }}
            required
            className="flex-1 px-2 py-1 rounded bg-surface-3 border border-surface-border text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTestNew}
              disabled={isTesting || !newUrl.trim()}
              className="text-xs font-mono px-3 py-1 rounded bg-surface-3 border border-surface-border text-text-secondary hover:text-text-primary hover:border-accent/40 disabled:opacity-40 transition-colors"
            >
              {isTesting ? 'Testing…' : 'Test'}
            </button>
            <button
              type="submit"
              disabled={addMutation.isPending || !newUrl.trim()}
              className="text-xs font-mono px-3 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors font-medium"
            >
              {addMutation.isPending ? 'Adding…' : 'Add Source'}
            </button>
          </div>
        </div>

        {/* Test feedback */}
        {testResult && (
          <div className="text-[11px] font-mono mt-1 p-2 rounded bg-surface-3 border border-surface-border">
            {testResult.ok ? (
              <div className="space-y-1">
                <span className="text-emerald-400 font-semibold">
                  ✓ Valid {testResult.mode?.toUpperCase()} feed found ({testResult.itemCount} items)
                </span>
                {testResult.sampleTitles && testResult.sampleTitles.length > 0 && (
                  <ul className="text-[10px] text-text-muted list-disc list-inside">
                    {testResult.sampleTitles.map((t, idx) => (
                      <li key={idx} className="truncate">{t}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <span className="text-red-400">✗ {testResult.error}</span>
            )}
          </div>
        )}

        {addMutation.isError && (
          <p className="text-[10px] text-red-400 font-mono">
            {addMutation.error instanceof Error ? addMutation.error.message : 'Error adding feed'}
          </p>
        )}
      </form>
    </div>
  );
}
