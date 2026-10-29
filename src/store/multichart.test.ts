import { describe, it, expect, beforeEach } from 'vitest';
import { useMultiChartStore } from './multichart';

describe('useMultiChartStore', () => {
  beforeEach(() => {
    useMultiChartStore.setState({
      mode: 'mtf',
      layout: '2x2',
      globalSymbol: 'BTCUSDT',
      syncCrosshair: true,
      maximizedTileId: null,
      overlays: {
        bb: true,
        ema20: true,
        ema90: true,
        ema200: true,
        signals: true,
      },
      tiles: [
        { id: 'tile-0', symbol: 'BTCUSDT', timeframe: '1d' },
        { id: 'tile-1', symbol: 'BTCUSDT', timeframe: '4h' },
        { id: 'tile-2', symbol: 'BTCUSDT', timeframe: '1h' },
        { id: 'tile-3', symbol: 'BTCUSDT', timeframe: '15m' },
      ],
    });
  });

  it('initializes with expected MTF defaults', () => {
    const s = useMultiChartStore.getState();
    expect(s.mode).toBe('mtf');
    expect(s.layout).toBe('2x2');
    expect(s.globalSymbol).toBe('BTCUSDT');
    expect(s.syncCrosshair).toBe(true);
    expect(s.overlays.ema20).toBe(true);
    expect(s.overlays.ema90).toBe(true);
    expect(s.overlays.ema200).toBe(true);
    expect(s.overlays.bb).toBe(true);
    expect(s.overlays.signals).toBe(true);
  });

  it('updates all tiles when global symbol changes in MTF mode', () => {
    useMultiChartStore.getState().setGlobalSymbol('ETHUSDT');
    const s = useMultiChartStore.getState();
    expect(s.globalSymbol).toBe('ETHUSDT');
    expect(s.tiles.every((t) => t.symbol === 'ETHUSDT')).toBe(true);
  });

  it('switches to watchlist mode with default watchlist assets', () => {
    useMultiChartStore.getState().setMode('watchlist');
    const s = useMultiChartStore.getState();
    expect(s.mode).toBe('watchlist');
    expect(s.tiles.length).toBeGreaterThanOrEqual(4);
    expect(s.tiles[0]?.symbol).toBe('BTCUSDT');
    expect(s.tiles[1]?.symbol).toBe('ETHUSDT');
    expect(s.tiles[2]?.symbol).toBe('SOLUSDT');
  });

  it('updates layout and clears any maximized tile', () => {
    useMultiChartStore.getState().toggleMaximizeTile('tile-1');
    expect(useMultiChartStore.getState().maximizedTileId).toBe('tile-1');

    useMultiChartStore.getState().setLayout('1+2');
    const s = useMultiChartStore.getState();
    expect(s.layout).toBe('1+2');
    expect(s.maximizedTileId).toBeNull();
  });

  it('toggles tile maximization', () => {
    useMultiChartStore.getState().toggleMaximizeTile('tile-2');
    expect(useMultiChartStore.getState().maximizedTileId).toBe('tile-2');

    // Toggling the same tile restores grid
    useMultiChartStore.getState().toggleMaximizeTile('tile-2');
    expect(useMultiChartStore.getState().maximizedTileId).toBeNull();
  });

  it('updates individual overlay toggles', () => {
    useMultiChartStore.getState().setOverlays({ ema200: false, bb: false });
    const s = useMultiChartStore.getState();
    expect(s.overlays.ema200).toBe(false);
    expect(s.overlays.bb).toBe(false);
    expect(s.overlays.ema20).toBe(true); // unchanged
  });

  it('updates a specific tile symbol and timeframe', () => {
    useMultiChartStore.getState().updateTile('tile-3', { timeframe: '5m', symbol: 'SOLUSDT' });
    const tile = useMultiChartStore.getState().tiles.find((t) => t.id === 'tile-3');
    expect(tile?.timeframe).toBe('5m');
    expect(tile?.symbol).toBe('SOLUSDT');
  });
});
