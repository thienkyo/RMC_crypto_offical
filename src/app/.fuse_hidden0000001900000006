import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'RMC Crypto',
  description: 'Personal crypto market monitor — paper trading only.',
};

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  themeColor:   '#0a0e1a',
};

/**
 * Root layout — adds a slim top nav bar with Chart | Strategy tabs.
 * The nav is a Server Component; children are rendered inside a flex container
 * that fills the remaining viewport height.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full">
      <body className="h-full flex flex-col overflow-hidden">
        <Providers>
          {/* ── Top nav ──────────────────────────────────────────────── */}
          <nav className="flex-shrink-0 flex items-center gap-1 px-3 py-0 h-9 border-b border-surface-border bg-surface z-10">
            {/* Brand */}
            <span className="text-xs font-semibold text-text-muted mr-3 tracking-wider">
              RMC
            </span>

            {/* Page links — Next.js Link renders <a> with client-side navigation */}
            <Link href="/"         className="nav-link">Chart</Link>
            <Link href="/strategy" className="nav-link">Strategy</Link>

            {/* Right spacer + paper-trade badge */}
            <span className="ml-auto text-xs font-mono text-amber-400/70">
              PAPER TRADING ONLY
            </span>
          </nav>

          {/* ── Page content ────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
