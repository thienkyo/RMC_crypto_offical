'use client';

/**
 * Toolbar button that opens the command palette.
 *
 * Kept out of CommandPalette.tsx deliberately: this renders in the root layout,
 * so co-locating them would pull the palette's whole import graph — four
 * persisted stores and the indicator registry — into every page for a button.
 * It opens the palette by dispatching the same window event the palette's own
 * keydown handler listens for, so there is no shared state between them.
 */
export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
      className="hidden sm:flex items-center gap-2 px-2 py-0.5 rounded bg-surface-2 border border-surface-border text-[11px] font-mono text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors ml-3"
      title="Open Command Palette (⌘K)"
    >
      <svg
        viewBox="0 0 16 16"
        className="w-3 h-3 text-text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l4 4" />
      </svg>
      <span>Jump / Search</span>
      <kbd className="text-[9px] bg-surface-3 px-1 rounded border border-surface-border text-text-secondary">
        ⌘K
      </kbd>
    </button>
  );
}
