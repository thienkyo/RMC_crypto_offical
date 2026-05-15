'use client';

/**
 * AlertManager — Phase 5 alert configuration panel.
 *
 * Renders a list of alert rules with enable/disable toggles,
 * a form to create/edit alerts, and a history log.
 *
 * Data flow:
 *   TanStack Query → GET /api/alerts → { rules, history }
 *   Mutations      → POST / PATCH / DELETE /api/alerts
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useChartStore } from '@/store/chart';
import { INDICATORS } from '@/lib/indicators';
import type { AlertRule, AlertHistoryEntry, CreateAlertInput, UpdateAlertInput } from '@/types/alert';
import type { Timeframe } from '@/types/market';
import { TIMEFRAMES } from '@/types/market';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertsApiResponse {
  rules:   AlertRule[];
  history: AlertHistoryEntry[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchAlerts(): Promise<AlertsApiResponse> {
  const res = await fetch('/api/alerts');
  if (!res.ok) throw new Error('Failed to fetch alerts');
  return res.json() as Promise<AlertsApiResponse>;
}

async function createAlert(input: CreateAlertInput): Promise<AlertRule> {
  const res = await fetch('/api/alerts', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to create alert');
  }
  const data = await res.json() as { rule: AlertRule };
  return data.rule;
}

async function updateAlert(input: UpdateAlertInput): Promise<AlertRule> {
  const res = await fetch('/api/alerts', {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to update alert');
  }
  const data = await res.json() as { rule: AlertRule };
  return data.rule;
}

async function toggleAlert(id: string, enabled: boolean): Promise<void> {
  const res = await fetch('/api/alerts', {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id, enabled }),
  });
  if (!res.ok) throw new Error('Failed to update alert');
}

async function deleteAlert(id: string): Promise<void> {
  const res = await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete alert');
}

/** Manually runs the full cron evaluation loop (respects cooldowns). */
async function runManual(): Promise<{ ok: boolean; fired?: number; error?: string }> {
  const res = await fetch('/api/cron/check-alerts');
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return res.json() as Promise<{ ok: boolean; fired?: number; error?: string }>;
}

/** Sends a hardcoded connectivity ping — ignores rules and cooldowns. */
async function pingTelegram(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/alerts/test');
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatCondition(rule: AlertRule): string {
  const { indicatorId, params, seriesIndex, operator, value } = rule.condition;

  const opLabel: Record<string, string> = {
    gt:            '>',
    lt:            '<',
    gte:           '>=',
    lte:           '<=',
    crosses_above: '↑ crosses',
    crosses_below: '↓ crosses',
  };
  const op = opLabel[operator] ?? operator;

  if (indicatorId === '__price__') return `Price ${op} ${value}`;

  const paramStr = Object.values(params).join(',');
  const id       = indicatorId.toUpperCase();
  const series   = seriesIndex > 0 ? `[${seriesIndex}]` : '';
  return `${id}(${paramStr})${series} ${op} ${value}`;
}

function formatRelativeTime(ts: number | null): string {
  if (ts === null) return 'Never';
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days  > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins  > 0) return `${mins}m ago`;
  return 'Just now';
}

function formatCooldown(ms: number): string {
  const mins  = ms / 60_000;
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${hours}h cooldown`;
  return `${mins}m cooldown`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AlertManager() {
  const queryClient = useQueryClient();
  const chartSymbol = useChartStore((s) => s.symbol);
  const chartTf     = useChartStore((s) => s.timeframe);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery<AlertsApiResponse>({
    queryKey: ['alerts'],
    queryFn:  fetchAlerts,
    refetchInterval: 30_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: createAlert,
    onSuccess:  () => { void queryClient.invalidateQueries({ queryKey: ['alerts'] }); },
  });

  const updateMutation = useMutation({
    mutationFn: updateAlert,
    onSuccess:  () => { void queryClient.invalidateQueries({ queryKey: ['alerts'] }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleAlert(id, enabled),
    onSuccess:  () => { void queryClient.invalidateQueries({ queryKey: ['alerts'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAlert,
    onSuccess:  () => { void queryClient.invalidateQueries({ queryKey: ['alerts'] }); },
  });

  // ── Form state — shared between create and edit ────────────────────────────
  const [showForm,      setShowForm]      = useState(false);
  const [editingRule,   setEditingRule]   = useState<AlertRule | null>(null);
  const [name,          setName]          = useState('');
  const [symbol,        setSymbol]        = useState(chartSymbol);
  const [timeframe,     setTimeframe]     = useState<Timeframe>(chartTf);
  const [indicatorId,   setIndicatorId]   = useState('rsi');
  const [seriesIndex,   setSeriesIndex]   = useState(0);
  const [operator,      setOperator]      = useState('lt');
  const [value,         setValue]         = useState('30');
  const [cooldownHours, setCooldownHours] = useState('1');
  const [params,        setParams]        = useState<Record<string, number>>(
    (INDICATORS['rsi']?.defaultParams ?? {}) as Record<string, number>,
  );
  const [formError,     setFormError]     = useState('');
  const [testStatus,    setTestStatus]    = useState<string | null>(null);
  const [manualStatus,  setManualStatus]  = useState<string | null>(null);

  const selectedIndicator = INDICATORS[indicatorId];

  // ── Open form for new rule ─────────────────────────────────────────────────
  function openNewForm() {
    setEditingRule(null);
    setName('');
    setSymbol(chartSymbol);
    setTimeframe(chartTf);
    setIndicatorId('rsi');
    setSeriesIndex(0);
    setOperator('lt');
    setValue('30');
    setCooldownHours('1');
    setParams((INDICATORS['rsi']?.defaultParams ?? {}) as Record<string, number>);
    setFormError('');
    setShowForm(true);
  }

  // ── Open form pre-populated for editing ───────────────────────────────────
  function openEditForm(rule: AlertRule) {
    setEditingRule(rule);
    setName(rule.name);
    setSymbol(rule.symbol);
    setTimeframe(rule.timeframe);
    setIndicatorId(rule.condition.indicatorId);
    setSeriesIndex(rule.condition.seriesIndex);
    setOperator(rule.condition.operator);
    setValue(String(rule.condition.value));
    setCooldownHours(String(rule.cooldownMs / 3_600_000));
    setParams(rule.condition.params);
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingRule(null);
    setFormError('');
  }

  function handleIndicatorChange(id: string) {
    setIndicatorId(id);
    const ind = INDICATORS[id];
    setParams((ind?.defaultParams ?? {}) as Record<string, number>);
    setSeriesIndex(0);
  }

  // ── Submit: create or update depending on editingRule ─────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    const numValue = parseFloat(value);
    if (!name.trim())    return setFormError('Name is required');
    if (!symbol.trim())  return setFormError('Symbol is required');
    if (isNaN(numValue)) return setFormError('Value must be a number');
    if (!selectedIndicator && indicatorId !== '__price__')
                         return setFormError('Unknown indicator');

    const condition: CreateAlertInput['condition'] = {
      id:          editingRule?.condition.id ?? crypto.randomUUID(),
      indicatorId,
      params,
      seriesIndex,
      operator:    operator as CreateAlertInput['condition']['operator'],
      value:       numValue,
    };

    if (editingRule) {
      // ── Edit mode: PATCH ─────────────────────────────────────────────────
      const input: UpdateAlertInput = {
        id:         editingRule.id,
        name:       name.trim(),
        condition,
        cooldownMs: parseFloat(cooldownHours) * 3_600_000,
      };
      updateMutation.mutate(input, {
        onSuccess: () => closeForm(),
        onError:   (err) => setFormError((err as Error).message),
      });
    } else {
      // ── Create mode: POST ────────────────────────────────────────────────
      const input: CreateAlertInput = {
        name:       name.trim(),
        symbol:     symbol.toUpperCase().trim(),
        timeframe,
        cooldownMs: parseFloat(cooldownHours) * 3_600_000,
        condition,
      };
      createMutation.mutate(input, {
        onSuccess: () => closeForm(),
        onError:   (err) => setFormError((err as Error).message),
      });
    }
  }

  async function handleTestTelegram() {
    setTestStatus('Sending…');
    const result = await pingTelegram();
    setTestStatus(result.ok ? '✓ Ping sent' : `✗ ${result.error}`);
    setTimeout(() => setTestStatus(null), 5000);
  }

  async function handleManual() {
    setManualStatus('Running…');
    const result = await runManual();
    if (!result.ok) {
      setManualStatus(`✗ ${result.error}`);
    } else {
      setManualStatus(result.fired ? `✓ ${result.fired} fired` : '✓ No rules triggered');
    }
    setTimeout(() => setManualStatus(null), 5000);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div className="p-4 text-xs text-zinc-500 font-mono">Loading alerts…</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-red-400 font-mono">
        Failed to load alerts: {(error as Error).message}
      </div>
    );
  }

  const rules   = data?.rules   ?? [];
  const history = data?.history ?? [];
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col gap-0 text-xs font-mono text-zinc-200">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-zinc-400 uppercase tracking-widest text-[10px]">
          Alerts
          <span className="ml-2 text-zinc-600">({rules.length})</span>
        </span>
        <div className="flex items-center gap-2">
          {(testStatus ?? manualStatus) && (
            <span className="text-zinc-400 text-[10px]">{testStatus ?? manualStatus}</span>
          )}
          <button
            onClick={() => void handleTestTelegram()}
            className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded transition-colors"
            title="Send a hardcoded ping to verify Telegram is connected"
          >
            Test ✈
          </button>
          <button
            onClick={() => void handleManual()}
            className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded transition-colors"
            title="Manually run the alert evaluation loop (respects cooldowns)"
          >
            Manual
          </button>
          <button
            onClick={() => showForm ? closeForm() : openNewForm()}
            className="px-2 py-0.5 text-[10px] text-zinc-900 bg-zinc-200 hover:bg-white rounded transition-colors"
          >
            {showForm ? '✕ Cancel' : '+ New'}
          </button>
        </div>
      </div>

      {/* ── Create / Edit form ──────────────────────────────────────────────── */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 px-3 py-3 border-b border-zinc-800 bg-zinc-900/60"
        >
          {/* Form heading */}
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">
            {editingRule ? `Editing: ${editingRule.name}` : 'New alert rule'}
          </div>

          {/* Name */}
          <input
            type="text"
            placeholder="Rule name (e.g. BTC RSI Oversold)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />

          {/* Symbol + Timeframe — locked when editing (condition is tied to symbol/tf) */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              disabled={!!editingRule}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              disabled={!!editingRule}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>
          {editingRule && (
            <p className="text-zinc-600 text-[10px] -mt-1">
              Symbol and timeframe cannot be changed — delete and recreate if needed.
            </p>
          )}

          {/* Indicator */}
          <select
            value={indicatorId}
            onChange={(e) => handleIndicatorChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
          >
            <option value="__price__">Price (close)</option>
            {Object.values(INDICATORS).map((ind) => (
              <option key={ind.id} value={ind.id}>{ind.name}</option>
            ))}
          </select>

          {/* Indicator params */}
          {indicatorId !== '__price__' && selectedIndicator && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(selectedIndicator.paramsMeta).map(([key, meta]) => (
                <label key={key} className="flex items-center gap-1 text-zinc-500">
                  <span>{meta.label}</span>
                  {meta.type === 'time' ? (
                    (() => {
                      const totalMins = params[key] ?? 0;
                      const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
                      const mm = String(totalMins % 60).padStart(2, '0');
                      return (
                        <input
                          type="time"
                          value={`${hh}:${mm}`}
                          onChange={(e) => {
                            const [h, m] = e.target.value.split(':').map(Number);
                            setParams((p) => ({ ...p, [key]: ((h ?? 0) * 60) + (m ?? 0) }));
                          }}
                          className="w-24 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                        />
                      );
                    })()
                  ) : meta.type === 'select' ? (
                    <select
                      value={params[key] ?? meta.options[0]?.value ?? 0}
                      onChange={(e) => setParams((p) => ({ ...p, [key]: parseFloat(e.target.value) }))}
                      className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                    >
                      {meta.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      value={params[key] ?? 0}
                      onChange={(e) => setParams((p) => ({ ...p, [key]: parseFloat(e.target.value) }))}
                      className="w-14 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                    />
                  )}
                </label>
              ))}
              {selectedIndicator.id === 'macd' && (
                <label className="flex items-center gap-1 text-zinc-500">
                  <span>Series</span>
                  <select
                    value={seriesIndex}
                    onChange={(e) => setSeriesIndex(parseInt(e.target.value, 10))}
                    className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 focus:outline-none"
                  >
                    <option value={0}>MACD Line</option>
                    <option value={1}>Signal</option>
                    <option value={2}>Histogram</option>
                  </select>
                </label>
              )}
              {selectedIndicator.id === 'bollinger' && (
                <label className="flex items-center gap-1 text-zinc-500">
                  <span>Series</span>
                  <select
                    value={seriesIndex}
                    onChange={(e) => setSeriesIndex(parseInt(e.target.value, 10))}
                    className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 focus:outline-none"
                  >
                    <option value={0}>Middle</option>
                    <option value={1}>Upper</option>
                    <option value={2}>Lower</option>
                  </select>
                </label>
              )}
            </div>
          )}

          {/* Operator + Value */}
          <div className="flex gap-2">
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
            >
              <option value="lt">&lt; less than</option>
              <option value="lte">&lt;= less or equal</option>
              <option value="gt">&gt; greater than</option>
              <option value="gte">&gt;= greater or equal</option>
              {indicatorId !== '__price__' && (
                <>
                  <option value="crosses_above">↑ crosses above</option>
                  <option value="crosses_below">↓ crosses below</option>
                </>
              )}
            </select>
            <input
              type="number"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {/* Cooldown */}
          <label className="flex items-center gap-2 text-zinc-500">
            <span>Cooldown (hours)</span>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={cooldownHours}
              onChange={(e) => setCooldownHours(e.target.value)}
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
          </label>

          {formError && (
            <p className="text-red-400 text-[10px]">{formError}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="self-end px-3 py-1 text-xs bg-zinc-200 text-zinc-900 rounded hover:bg-white disabled:opacity-50 transition-colors"
          >
            {isPending
              ? 'Saving…'
              : editingRule ? 'Save Changes' : 'Create Alert'}
          </button>
        </form>
      )}

      {/* ── Rule list ───────────────────────────────────────────────────────── */}
      {rules.length === 0 && !showForm && (
        <div className="px-3 py-4 text-zinc-600 text-center">
          No alert rules yet. Click + New to create one.
        </div>
      )}

      {rules.map((rule) => (
        <div
          key={rule.id}
          className={`flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60 transition-colors group ${
            editingRule?.id === rule.id
              ? 'bg-zinc-800/50 border-l-2 border-l-zinc-400'
              : 'hover:bg-zinc-800/30'
          }`}
        >
          {/* Enable toggle */}
          <button
            onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
            className={`w-7 h-4 rounded-full transition-colors flex-shrink-0 ${
              rule.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
            title={rule.enabled ? 'Disable' : 'Enable'}
          >
            <span
              className={`block w-3 h-3 rounded-full bg-white shadow transition-transform mx-0.5 ${
                rule.enabled ? 'translate-x-3' : 'translate-x-0'
              }`}
            />
          </button>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-zinc-200 font-medium truncate">{rule.name}</span>
              <span className="text-zinc-600 flex-shrink-0">
                {rule.symbol} · {rule.timeframe}
              </span>
            </div>
            <div className="flex items-center gap-2 text-zinc-500 text-[10px] mt-0.5">
              <span className="text-zinc-400">{formatCondition(rule)}</span>
              <span>·</span>
              <span>{formatCooldown(rule.cooldownMs)}</span>
              <span>·</span>
              <span>last: {formatRelativeTime(rule.lastFiredAt)}</span>
            </div>
          </div>

          {/* Edit + Delete — revealed on hover */}
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={() => editingRule?.id === rule.id ? closeForm() : openEditForm(rule)}
              className="text-zinc-500 hover:text-zinc-200 text-sm px-1"
              title="Edit rule"
            >
              ✎
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete "${rule.name}"?`)) deleteMutation.mutate(rule.id);
              }}
              className="text-zinc-700 hover:text-red-400 text-sm px-1"
              title="Delete rule"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {/* ── History log ─────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="border-t border-zinc-800 mt-1">
          <div className="px-3 py-1.5 text-[10px] text-zinc-600 uppercase tracking-widest">
            Recent Firings
          </div>
          {history.slice(0, 10).map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 px-3 py-1.5 border-b border-zinc-800/40 hover:bg-zinc-800/20"
            >
              <span className={`text-[10px] mt-0.5 flex-shrink-0 ${entry.delivered ? 'text-emerald-500' : 'text-yellow-500'}`}>
                {entry.delivered ? '✓' : '…'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-zinc-400 text-[10px] truncate leading-tight">
                  {entry.message.split('\n')[0]?.replace(/[<>\/]/g, '').replace(/^🔔 /, '')}
                </div>
                <div className="text-zinc-600 text-[10px]">
                  {formatRelativeTime(entry.firedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
