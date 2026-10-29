/**
 * Next.js instrumentation hook.
 * Invoked once when the Next.js Node.js server starts up.
 */
export async function register() {
  // Only run in the Node.js runtime environment (not edge, not during build)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Avoid running during static build or test runners
    if (
      process.env.NEXT_PHASE === 'phase-production-build' ||
      process.env.VITEST ||
      process.env.NODE_ENV === 'test'
    ) {
      return;
    }

    const { startServerAlertPoller } = await import('@/lib/cron/serverPoller');
    startServerAlertPoller();
  }
}
