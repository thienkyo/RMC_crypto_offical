/**
 * Layout store — controls visibility of the left (watchlist) and right
 * (AI / news / alerts) rails on the chart page.
 *
 * Using Zustand so ChartLayout can read and toggle the state directly
 * without prop-drilling through page.tsx.
 */

import { create } from 'zustand';

interface LayoutState {
  leftRailVisible:  boolean;
  rightRailVisible: boolean;
  toggleLeft:  () => void;
  toggleRight: () => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  leftRailVisible:  true,
  rightRailVisible: true,
  toggleLeft:  () => set((s) => ({ leftRailVisible:  !s.leftRailVisible  })),
  toggleRight: () => set((s) => ({ rightRailVisible: !s.rightRailVisible })),
}));
