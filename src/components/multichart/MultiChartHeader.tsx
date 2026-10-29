'use client';

import { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  useMultiChartStore,
  type MultiChartLayout,
  type MultiChartMode,
} from '@/store/multichart';

const POPULAR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'NEARUSDT', 'PAXGUSDT'];

const LAYOUTS: { id: MultiChartLayout; label: string; icon: string }[] = [
  { id: '1x1', label: 'Single (1x1)', icon: '▢' },
  { id: '1x2', label: 'Vertical Split (1x2)', icon: '◫' },
  { id: '2x1', label: 'Side by Side (2x1)', icon: '▥' },
  { id: '2x2', label: 'Quad Grid (2x2)', icon: '⊞' },
  { id: '1+2', label: 'Featured 1+2', icon: '⧉' },
  { id: '3x2', label: '6 Tiles (3x2)', icon: '⠿' },
];

interface MultiChartHeaderProps {
  isPopout?: boolean;
}

export function MultiChartHeader({ isPopout = false }: MultiChartHeaderProps) {
  const mode = useMultiChartStore((s) => s.mode);
  const layout = useMultiChartStore((s) => s.layout);
  const globalSymbol = useMultiChartStore((s) => s.globalSymbol);
  const syncCrosshair = useMultiChartStore((s) => s.syncCrosshair);
  const overlays = useMultiChartStore((s) => s.overlays);

  const setMode = useMultiChartStore((s) => s.setMode);
  const setLayout = useMultiChartStore((s) => s.setLayout);
  const setGlobalSymbol = useMultiChartStore((s) => s.setGlobalSymbol);
  const setSyncCrosshair = useMultiChartStore((s) => s.setSyncCrosshair);
  const setOverlays = useMultiChartStore((s) => s.setOverlays);
  const resetDefaultTiles = useMultiChartStore((s) => s.resetDefaultTiles);

  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const overlaysRef = useRef<HTMLDivElement>(null);

  const [symbolEditing, setSymbolEditing] = useState(false);
  const [symbolText, setSymbolText] = useState(globalSymbol);

  // Close overlays dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overlaysRef.current && !overlaysRef.current.contains(e.target as Node)) {
        setOverlaysOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePopOut = () => {
    window.open(
      '/multichart?popout=true',
      'RMC_MultiChart_Window',
      'width=1600,height=960,menubar=no,toolbar=no,location=no,status=no',
    );
  };

  return (
    <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-[#0a0e1a] border-b border-[#1e2a3d] text-xs gap-3">
      {/* ── Left Group: Mode switch & Global symbol (if MTF) ── */}
      <div className="flex items-center gap-3">
        {/* Mode Toggle */}
        <div className="flex items-center bg-[#141c2e] p-0.5 rounded-lg border border-[#1e2a3d]">
          <button
            type="button"
            onClick={() => setMode('mtf')}
            className={clsx(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              mode === 'mtf'
                ? 'bg-blue-600 text-white font-bold shadow-sm'
                : 'text-gray-400 hover:text-white',
            )}
          >
            Multi-Timeframe
          </button>
          <button
            type="button"
            onClick={() => setMode('watchlist')}
            className={clsx(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              mode === 'watchlist'
                ? 'bg-blue-600 text-white font-bold shadow-sm'
                : 'text-gray-400 hover:text-white',
            )}
          >
            Watchlist Grid
          </button>
        </div>

        {/* Global Symbol Selector (Active in MTF mode) */}
        {mode === 'mtf' && (
          <div className="flex items-center gap-1.5 bg-[#141c2e] px-2 py-1 rounded-lg border border-[#1e2a3d]">
            <span className="text-[11px] text-gray-400">Symbol:</span>
            {symbolEditing ? (
              <input
                type="text"
                autoFocus
                value={symbolText}
                onChange={(e) => setSymbolText(e.target.value)}
                onBlur={() => {
                  setSymbolEditing(false);
                  const trimmed = symbolText.trim().toUpperCase();
                  if (trimmed) setGlobalSymbol(trimmed);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSymbolEditing(false);
                    const trimmed = symbolText.trim().toUpperCase();
                    if (trimmed) setGlobalSymbol(trimmed);
                  }
                  if (e.key === 'Escape') setSymbolEditing(false);
                }}
                className="w-24 px-1.5 py-0.5 bg-[#0d1322] border border-blue-500 rounded text-xs font-mono font-bold text-white outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSymbolText(globalSymbol);
                  setSymbolEditing(true);
                }}
                className="font-mono font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1"
                title="Click to type a different symbol"
              >
                <span>{globalSymbol}</span>
                <span className="text-[10px] text-gray-500">✎</span>
              </button>
            )}

            {/* Quick Symbol Chips */}
            <div className="hidden lg:flex items-center gap-1 ml-2 border-l border-[#1e2a3d] pl-2">
              {POPULAR_SYMBOLS.slice(0, 4).map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setGlobalSymbol(sym)}
                  className={clsx(
                    'px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors',
                    globalSymbol === sym
                      ? 'bg-blue-600/30 text-blue-300 font-semibold'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e2a3d]',
                  )}
                >
                  {sym.replace('USDT', '')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Center: Layout Grid Selector ── */}
      <div className="flex items-center gap-1 bg-[#141c2e] p-0.5 rounded-lg border border-[#1e2a3d]">
        {LAYOUTS.map((l) => {
          const active = layout === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setLayout(l.id)}
              title={l.label}
              className={clsx(
                'px-2 py-1 rounded text-xs font-mono transition-colors flex items-center gap-1',
                active
                  ? 'bg-blue-600 text-white font-bold shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-[#1e2a3d]',
              )}
            >
              <span className="text-sm">{l.icon}</span>
              <span className="hidden md:inline text-[11px]">{l.id}</span>
            </button>
          );
        })}
      </div>

      {/* ── Right Group: Indicators, Crosshair Sync, Pop Out, Reset ── */}
      <div className="flex items-center gap-2">
        {/* Indicators Overlay Dropdown */}
        <div ref={overlaysRef} className="relative">
          <button
            type="button"
            onClick={() => setOverlaysOpen((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 bg-[#141c2e] hover:bg-[#1e2a3d] text-gray-200 rounded-lg border border-[#1e2a3d] text-xs transition-colors"
          >
            <span>⚙ Overlays</span>
            <span className="text-[10px] text-gray-400">▾</span>
          </button>

          {overlaysOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-[#0d1322] border border-[#1e2a3d] rounded-lg shadow-xl p-2.5 z-50 flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pb-1 border-b border-[#1e2a3d]">
                Chart Indicators
              </span>

              {/* Bollinger Bands */}
              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer hover:text-white">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
                  Bollinger Bands (20, 2)
                </span>
                <input
                  type="checkbox"
                  checked={overlays.bb}
                  onChange={(e) => setOverlays({ bb: e.target.checked })}
                  className="rounded bg-[#141c2e] border-[#1e2a3d] text-blue-600 focus:ring-0"
                />
              </label>

              {/* EMA 20 */}
              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer hover:text-white">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
                  EMA 20
                </span>
                <input
                  type="checkbox"
                  checked={overlays.ema20}
                  onChange={(e) => setOverlays({ ema20: e.target.checked })}
                  className="rounded bg-[#141c2e] border-[#1e2a3d] text-blue-600 focus:ring-0"
                />
              </label>

              {/* EMA 90 */}
              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer hover:text-white">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  EMA 90
                </span>
                <input
                  type="checkbox"
                  checked={overlays.ema90}
                  onChange={(e) => setOverlays({ ema90: e.target.checked })}
                  className="rounded bg-[#141c2e] border-[#1e2a3d] text-blue-600 focus:ring-0"
                />
              </label>

              {/* EMA 200 */}
              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer hover:text-white">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
                  EMA 200
                </span>
                <input
                  type="checkbox"
                  checked={overlays.ema200}
                  onChange={(e) => setOverlays({ ema200: e.target.checked })}
                  className="rounded bg-[#141c2e] border-[#1e2a3d] text-blue-600 focus:ring-0"
                />
              </label>

              {/* Strategy Signals */}
              <label className="flex items-center justify-between text-xs text-gray-200 cursor-pointer hover:text-white pt-1 border-t border-[#1e2a3d]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                  Strategy Signals
                </span>
                <input
                  type="checkbox"
                  checked={overlays.signals}
                  onChange={(e) => setOverlays({ signals: e.target.checked })}
                  className="rounded bg-[#141c2e] border-[#1e2a3d] text-blue-600 focus:ring-0"
                />
              </label>
            </div>
          )}
        </div>

        {/* Sync Crosshair Toggle */}
        <button
          type="button"
          onClick={() => setSyncCrosshair(!syncCrosshair)}
          title="Synchronize crosshair across all tiles"
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors',
            syncCrosshair
              ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-medium'
              : 'bg-[#141c2e] border-[#1e2a3d] text-gray-400 hover:text-white',
          )}
        >
          <span>✛</span>
          <span className="hidden sm:inline">Sync Crosshair</span>
        </button>

        {/* Pop Out in Window (only visible when not already popped out) */}
        {!isPopout && (
          <button
            type="button"
            onClick={handlePopOut}
            title="Open multi-chart in a dedicated browser window"
            className="flex items-center gap-1 px-2.5 py-1 bg-[#141c2e] hover:bg-[#1e2a3d] text-gray-300 hover:text-white rounded-lg border border-[#1e2a3d] text-xs transition-colors"
          >
            <span>⤢</span>
            <span className="hidden sm:inline">Pop Out</span>
          </button>
        )}

        {/* Reset Tiles */}
        <button
          type="button"
          onClick={() => resetDefaultTiles()}
          title="Reset grid tiles to defaults"
          className="text-gray-500 hover:text-gray-300 px-1.5 py-1 text-xs"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
