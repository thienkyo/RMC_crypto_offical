'use client';

/**
 * StrategyList Row & Section Header Components:
 * - TemplateRow: Blueprint template item
 * - StrategyRow: Standard/MTF strategy item with live toggle & options menu
 * - CommonStrategyRow: Multi-ticker shared strategy item
 * - SectionHeader: Collapsible section title bar
 */

import { useState } from 'react';
import type { Strategy } from '@/types/strategy';
import { OptionsPopover } from './StrategyPopovers';

// ── Template row ──────────────────────────────────────────────────────────────

export interface TemplateRowProps {
  s:        Strategy;
  active:   boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function TemplateRow({ s, active, onSelect, onDelete }: TemplateRowProps) {
  return (
    <div
      className={`group flex items-center justify-between pl-3 pr-2.5 py-1.5 cursor-pointer
                  hover:bg-surface-2 transition-colors
                  ${active ? 'bg-surface-2 border-l-2 border-violet-500 font-medium' : 'border-l-2 border-transparent'}`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-violet-400 flex-shrink-0">✦</span>
          <span className="text-sm text-text-primary truncate">{s.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-text-muted font-mono">{s.symbol} · {s.timeframe}</span>
          <span className={`text-[9px] font-mono font-semibold px-1 py-px rounded flex-shrink-0 ${
            s.action.type === 'enter_long'
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400'
          }`}>
            {s.action.type === 'enter_long' ? '▲ Bull' : '▼ Bear'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 ml-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete template "${s.name}"?`)) onDelete();
          }}
          className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
          title="Delete template"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ── Strategy row ──────────────────────────────────────────────────────────────

export interface RowProps {
  s:               Strategy;
  active:          boolean;
  /** Full strategy list passed through for the OptionsPopover. */
  allStrategies:   Strategy[];
  onSelect:        () => void;
  onToggle:        () => void;
  onDuplicate:     () => void;
  onDelete:        () => void;
  onCloneToSymbol: (targetSymbol: string) => void;
  onMerge:         (sourceIds: string[]) => void;
  onConvertToCommon?: () => void;
}

export function StrategyRow({
  s,
  active,
  allStrategies,
  onSelect,
  onToggle,
  onDuplicate,
  onDelete,
  onCloneToSymbol,
  onMerge,
  onConvertToCommon,
}: RowProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <div className="relative">
      <div
        className={`group flex items-center justify-between pl-3 pr-2.5 py-1.5 cursor-pointer
                    hover:bg-surface-2 transition-colors
                    ${active ? 'bg-surface-2 border-l-2 border-blue-500 font-medium' : 'border-l-2 border-transparent'}`}
        onClick={onSelect}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs truncate ${active ? 'text-text-primary font-medium' : 'text-text-secondary group-hover:text-text-primary'}`}>
              {s.name}
            </span>
            {(s.isActive ?? false) && (
              <span className={`text-[9px] font-bold flex-shrink-0 animate-pulse
                               ${s.action.type === 'enter_long' ? 'text-emerald-400' : 'text-red-400'}`}>
                {s.action.type === 'enter_long' ? '▲' : '▼'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
            <span>{s.timeframe}</span>
            {s.aiGatekeeperEnabled && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 font-semibold select-none" title="AI Gatekeeper Enabled for this strategy">
                AI
              </span>
            )}
            {s.notifyOnSignal && (
              <span className="text-[9px] text-emerald-400/80 select-none" title="Telegram Notifications Active">
                🔔
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 ml-1">
          {/* Live monitor toggle — kept outside ⋯ for instant access */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`btn-icon-xs transition-colors ${
              (s.isActive ?? false)
                ? 'text-emerald-400 hover:text-emerald-300'
                : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary'
            }`}
            title={(s.isActive ?? false) ? 'Turn off live monitor' : 'Turn on live monitor'}
          >
            ⏻
          </button>

          {/* ⋯ options menu */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOptionsOpen((v) => !v); }}
            className={`btn-icon-xs transition-colors text-[16px] leading-none tracking-tighter ${
              optionsOpen
                ? 'text-accent opacity-100'
                : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-accent'
            }`}
            title="Options"
          >
            ···
          </button>
        </div>
      </div>

      {optionsOpen && (
        <OptionsPopover
          strategy={s}
          allStrategies={allStrategies}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onCloneToSymbol={onCloneToSymbol}
          onMerge={onMerge}
          onConvertToCommon={onConvertToCommon}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </div>
  );
}

// ── Common Strategy row ───────────────────────────────────────────────────────

export interface CommonStrategyRowProps {
  s: Strategy;
  active: boolean;
  allStrategies: Strategy[];
  onSelect: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function CommonStrategyRow({
  s,
  active,
  onSelect,
  onToggle,
  onDelete,
}: CommonStrategyRowProps) {
  const symbols = s.symbols && s.symbols.length > 0 ? s.symbols : [s.symbol];

  return (
    <div className="relative">
      <div
        className={`group flex items-center justify-between pl-3 pr-2.5 py-1.5 cursor-pointer
                    hover:bg-surface-2 transition-colors
                    ${active ? 'bg-surface-2 border-l-2 border-purple-500 font-medium' : 'border-l-2 border-transparent'}`}
        onClick={onSelect}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-purple-400 flex-shrink-0">🔗</span>
            <span className={`text-xs truncate ${active ? 'text-text-primary font-medium' : 'text-text-secondary group-hover:text-text-primary'}`}>
              {s.name}
            </span>
            {(s.isActive ?? false) && (
              <span className={`text-[9px] font-bold flex-shrink-0 animate-pulse
                               ${s.action.type === 'enter_long' ? 'text-emerald-400' : 'text-red-400'}`}>
                {s.action.type === 'enter_long' ? '▲' : '▼'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-text-muted font-mono">{s.timeframe}</span>
            <div className="flex items-center gap-0.5 flex-wrap">
              {symbols.slice(0, 3).map((sym) => (
                <span key={sym} className="text-[9px] font-mono px-1 py-px rounded bg-purple-500/15 text-purple-300">
                  {sym.replace('USDT', '')}
                </span>
              ))}
              {symbols.length > 3 && (
                <span className="text-[9px] font-mono text-purple-400 font-semibold">+{symbols.length - 3}</span>
              )}
            </div>
            {s.notifyOnSignal && (
              <span className="text-[9px] text-emerald-400/80 ml-auto select-none" title="Telegram Notifications Active">
                🔔
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 ml-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`btn-icon-xs transition-colors ${
              (s.isActive ?? false)
                ? 'text-emerald-400 hover:text-emerald-300'
                : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary'
            }`}
            title={(s.isActive ?? false) ? 'Turn off live monitor' : 'Turn on live monitor'}
          >
            ⏻
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete common strategy "${s.name}"?`)) onDelete();
            }}
            className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
            title="Delete common strategy"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  label:       string;
  isCollapsed: boolean;
  onToggle:    () => void;
  onAdd:       () => void;
  addTitle:    string;
  count:       number;
  accent?:     'blue' | 'violet' | 'cyan';
}

export function SectionHeader({
  label,
  isCollapsed,
  onToggle,
  onAdd,
  addTitle,
  count,
  accent = 'blue',
}: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors select-none"
      >
        <span className={`text-[10px] transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}>
          ▾
        </span>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${
          accent === 'violet' ? 'text-violet-400' :
          accent === 'cyan' ? 'text-cyan-400' : 'text-blue-400'
        }`}>
          {label}
        </span>
        <span className="text-[10px] font-mono text-text-muted">{count}</span>
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="btn-icon-xs text-text-muted hover:text-text-primary"
        title={addTitle}
      >
        +
      </button>
    </div>
  );
}
