import type { Strategy } from '@/types/strategy';

export interface SyncResult {
  pulled: number;
  pushed: number;
  merged: number;
}

/**
 * Sync local strategies with DB strategies using a bidirectional merge.
 * Newer 'updatedAt' timestamps win in case of conflict.
 */
export async function syncStrategies(
  localList: Strategy[],
  setLocal: (strategies: Strategy[]) => void
): Promise<SyncResult> {
  // 1. Fetch DB strategies
  const res = await fetch('/api/strategies');
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
  const data = await res.json() as { strategies: Strategy[] };
  const dbList = data.strategies;

  const localMap = new Map(localList.map((s) => [s.id, s]));
  const dbMap = new Map(dbList.map((s) => [s.id, s]));

  const mergedList: Strategy[] = [];
  const toUpload: Strategy[] = [];
  let pulled = 0;
  let pushed = 0;
  let merged = 0;

  const allIds = new Set([...localMap.keys(), ...dbMap.keys()]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const db = dbMap.get(id);

    if (local && db) {
      const localTime = local.updatedAt ?? 0;
      const dbTime = db.updatedAt ?? 0;

      if (dbTime > localTime) {
        mergedList.push(db);
        pulled++;
        merged++;
      } else if (localTime > dbTime) {
        mergedList.push(local);
        toUpload.push(local);
        pushed++;
        merged++;
      } else {
        mergedList.push(local);
      }
    } else if (local) {
      // Exists only locally -> upload to DB
      mergedList.push(local);
      toUpload.push(local);
      pushed++;
    } else if (db) {
      // Exists only in DB -> pull to local
      mergedList.push(db);
      pulled++;
    }
  }

  // 2. Upload newer/missing local strategies to Postgres
  if (toUpload.length > 0) {
    await Promise.all(
      toUpload.map(async (s) => {
        await fetch('/api/strategies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(s),
        }).catch((err) => console.warn(`[sync:upload] Failed to push ${s.name}:`, err));
      })
    );
  }

  // 3. Update the local Zustand store (will trigger localStorage persist)
  setLocal(mergedList);

  return { pulled, pushed, merged };
}
