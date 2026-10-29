'use client';

import { useState, useCallback } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { clsx } from 'clsx';
import { useMultiChartStore } from '@/store/multichart';
import { ChartTile } from './ChartTile';

export function MultiChartGrid() {
  const layout = useMultiChartStore((s) => s.layout);
  const tiles = useMultiChartStore((s) => s.tiles);
  const maximizedTileId = useMultiChartStore((s) => s.maximizedTileId);

  const [sharedCrosshairTime, setSharedCrosshairTime] = useState<UTCTimestamp | null>(null);

  const handleCrosshairMove = useCallback((time: UTCTimestamp | null) => {
    setSharedCrosshairTime(time);
  }, []);

  // 1. If a single tile is maximized, show only that tile taking 100% of the viewport
  if (maximizedTileId) {
    const tile = tiles.find((t) => t.id === maximizedTileId) ?? tiles[0];
    if (tile) {
      return (
        <div className="flex-1 min-h-0 w-full h-full p-1 bg-[#070b14]">
          <ChartTile
            tile={tile}
            sharedCrosshairTime={sharedCrosshairTime}
            onCrosshairMove={handleCrosshairMove}
            isMaximized={true}
          />
        </div>
      );
    }
  }

  // 2. Featured 1+2 layout: Tile 0 takes 2 cols and 2 rows, Tiles 1 & 2 stack on the right
  if (layout === '1+2') {
    const visibleTiles = tiles.slice(0, 3);
    return (
      <div className="flex-1 min-h-0 w-full h-full p-1 bg-[#070b14] grid grid-cols-3 grid-rows-2 gap-1 overflow-hidden">
        {visibleTiles[0] && (
          <div className="col-span-2 row-span-2 min-h-0 min-w-0">
            <ChartTile
              tile={visibleTiles[0]}
              sharedCrosshairTime={sharedCrosshairTime}
              onCrosshairMove={handleCrosshairMove}
            />
          </div>
        )}
        {visibleTiles[1] && (
          <div className="col-span-1 row-span-1 min-h-0 min-w-0">
            <ChartTile
              tile={visibleTiles[1]}
              sharedCrosshairTime={sharedCrosshairTime}
              onCrosshairMove={handleCrosshairMove}
            />
          </div>
        )}
        {visibleTiles[2] && (
          <div className="col-span-1 row-span-1 min-h-0 min-w-0">
            <ChartTile
              tile={visibleTiles[2]}
              sharedCrosshairTime={sharedCrosshairTime}
              onCrosshairMove={handleCrosshairMove}
            />
          </div>
        )}
      </div>
    );
  }

  // 3. Standard grid layouts
  let gridClass = 'grid-cols-2 grid-rows-2';
  let count = 4;

  switch (layout) {
    case '1x1':
      gridClass = 'grid-cols-1 grid-rows-1';
      count = 1;
      break;
    case '1x2':
      gridClass = 'grid-cols-1 grid-rows-2';
      count = 2;
      break;
    case '2x1':
      gridClass = 'grid-cols-2 grid-rows-1';
      count = 2;
      break;
    case '2x2':
      gridClass = 'grid-cols-2 grid-rows-2';
      count = 4;
      break;
    case '3x2':
      gridClass = 'grid-cols-3 grid-rows-2';
      count = 6;
      break;
  }

  const visibleTiles = tiles.slice(0, count);

  return (
    <div
      className={clsx(
        'flex-1 min-h-0 w-full h-full p-1 bg-[#070b14] grid gap-1 overflow-hidden',
        gridClass,
      )}
    >
      {visibleTiles.map((tile) => (
        <div key={tile.id} className="min-h-0 min-w-0 h-full w-full">
          <ChartTile
            tile={tile}
            sharedCrosshairTime={sharedCrosshairTime}
            onCrosshairMove={handleCrosshairMove}
          />
        </div>
      ))}
    </div>
  );
}
