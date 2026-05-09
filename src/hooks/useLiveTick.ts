'use client';

/**
 * Live tick subscription has been moved directly into ChartLayout so ticks
 * can call priceRef.current.updateCandle() (series.update() under the hood)
 * without going through Zustand → React re-render → setData().
 *
 * This file is intentionally empty. It's kept so any future consumer that
 * needs tick data outside the chart can import a hook from here.
 */
export {};
