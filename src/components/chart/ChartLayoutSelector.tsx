'use client';

import { useState, useRef, useEffect } from 'react';
import { useChartLayoutStore, type SavedChartLayout } from '@/store/chartLayouts';
import { useChartStore } from '@/store/chart';
import { clsx } from 'clsx';

export function ChartLayoutSelector() {
  const layouts           = useChartLayoutStore((s) => s.layouts);
  const activeLayoutId    = useChartLayoutStore((s) => s.activeLayoutId);
  const applyLayout       = useChartLayoutStore((s) => s.applyLayout);
  const saveCurrentLayout = useChartLayoutStore((s) => s.saveCurrentLayout);
  const updateActiveLayout= useChartLayoutStore((s) => s.updateActiveLayout);
  const deleteLayout      = useChartLayoutStore((s) => s.deleteLayout);
  const renameLayout      = useChartLayoutStore((s) => s.renameLayout);

  const activeSymbol = useChartStore((s) => s.symbol);

  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState('');
  const [pinSymbol, setPinSymbol] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const menuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const activeLayout = layouts.find((l) => l.id === activeLayoutId) ?? null;

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setIsSaving(false);
        setEditingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-focus input when saving
  useEffect(() => {
    if (isSaving && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isSaving]);

  const handleSaveNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLayoutName.trim()) return;
    saveCurrentLayout(newLayoutName, pinSymbol);
    setNewLayoutName('');
    setIsSaving(false);
    setOpen(false);
  };

  const handleRename = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editingName.trim()) return;
    renameLayout(id, editingName);
    setEditingId(null);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-mono transition-colors',
          open
            ? 'border-accent/40 text-accent bg-accent/5'
            : 'border-surface-border text-text-muted hover:text-text-primary hover:border-accent/30',
        )}
        title="Saved chart layouts (symbol, timeframe, indicators, viewport)"
      >
        <svg
          viewBox="0 0 16 16"
          className="w-3 h-3 text-text-muted flex-shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
          <path d="M2 6h12M6 6v8" />
        </svg>
        <span className="truncate max-w-[110px]">
          {activeLayout ? activeLayout.name : 'Layout'}
        </span>
        <span className="text-[8px] opacity-60">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 bg-surface-1 border border-surface-border
                     rounded-lg shadow-2xl z-50 p-1.5 text-[11px] font-mono"
        >
          <div className="px-2 py-1 mb-1 border-b border-surface-border flex items-center justify-between text-text-muted text-[10px] uppercase tracking-wider">
            <span>Chart Layouts</span>
            {activeLayout && !activeLayout.isBuiltIn && (
              <button
                type="button"
                onClick={() => {
                  updateActiveLayout();
                  setOpen(false);
                }}
                className="text-accent hover:underline lowercase font-normal"
                title="Overwrite active layout with current chart state"
              >
                update
              </button>
            )}
          </div>

          {/* Layout List */}
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {layouts.map((layout) => {
              const isActive = layout.id === activeLayoutId;
              const isRenaming = editingId === layout.id;

              if (isRenaming) {
                return (
                  <form
                    key={layout.id}
                    onSubmit={(e) => handleRename(layout.id, e)}
                    className="flex items-center gap-1 px-2 py-1 bg-surface-2 rounded"
                  >
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1 bg-surface-3 border border-surface-border rounded px-1.5 py-0.5 text-text-primary text-[11px] outline-none"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="px-1.5 py-0.5 bg-accent text-white rounded text-[10px]"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-1.5 py-0.5 text-text-muted hover:text-text-primary text-[10px]"
                    >
                      ✕
                    </button>
                  </form>
                );
              }

              return (
                <div
                  key={layout.id}
                  onClick={() => {
                    applyLayout(layout.id);
                    setOpen(false);
                  }}
                  className={clsx(
                    'group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors',
                    isActive
                      ? 'bg-accent/15 text-accent font-semibold'
                      : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[10px] w-3 flex-shrink-0 text-center">
                      {isActive ? '✓' : ''}
                    </span>
                    <span className="truncate">{layout.name}</span>
                    <span className="text-[9px] text-text-muted flex-shrink-0">
                      [{layout.timeframe}]
                    </span>
                    {layout.symbol && (
                      <span className="text-[9px] text-amber-400/80 flex-shrink-0">
                        ({layout.symbol})
                      </span>
                    )}
                  </div>

                  {/* Actions for custom layouts */}
                  {!layout.isBuiltIn && (
                    <div
                      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(layout.id);
                          setEditingName(layout.name);
                        }}
                        title="Rename"
                        className="text-text-muted hover:text-text-primary p-0.5"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLayout(layout.id)}
                        title="Delete"
                        className="text-text-muted hover:text-red-400 p-0.5"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Divider */}
          <div className="my-1 border-t border-surface-border" />

          {/* Save As New Layout Form */}
          {isSaving ? (
            <form onSubmit={handleSaveNew} className="p-1 space-y-2 bg-surface-2 rounded">
              <input
                ref={nameInputRef}
                type="text"
                placeholder="Layout name (e.g. Scalp 5m)"
                value={newLayoutName}
                onChange={(e) => setNewLayoutName(e.target.value)}
                className="w-full bg-surface-3 border border-surface-border rounded px-2 py-1
                           text-[11px] text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
              />

              <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pinSymbol}
                  onChange={(e) => setPinSymbol(e.target.checked)}
                  className="rounded border-surface-border bg-surface-3 text-accent focus:ring-0"
                />
                <span>Pin to current symbol ({activeSymbol})</span>
              </label>

              <div className="flex items-center justify-end gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsSaving(false);
                    setNewLayoutName('');
                  }}
                  className="px-2 py-0.5 text-text-muted hover:text-text-primary text-[10px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newLayoutName.trim()}
                  className="px-2 py-0.5 bg-accent text-white rounded text-[10px] disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsSaving(true)}
              className="w-full text-left px-2 py-1.5 rounded text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5"
            >
              <span>+</span>
              <span>Save current setup as new layout...</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
