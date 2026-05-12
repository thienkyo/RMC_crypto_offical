/**
 * Indicator registry — single source of truth used by:
 *   • Chart overlay renderer (Phase 1)
 *   • Strategy condition builder (Phase 2)
 *   • Backtester (Phase 2)
 *
 * To add a new indicator: implement the Indicator<P> interface,
 * import it here, and add it to INDICATORS.
 */
export { ema }       from './ema';
export { sma }       from './sma';
export { rsi }       from './rsi';
export { macd }      from './macd';
export { bollinger } from './bollinger';
export { bbpct }     from './bbpct';

// Patterns
export {
  abandonedBabyBearish,
  abandonedBabyBullish,
  identicalThreeCrows,
  advanceBlock,
  bearishDojiStar
} from '../patterns';

export type {
  Indicator,
  IndicatorResult,
  IndicatorSeries,
  IndicatorPoint,
  IndicatorMarker,
  ParamMeta,
} from './types';

import { ema }       from './ema';
import { sma }       from './sma';
import { rsi }       from './rsi';
import { macd }      from './macd';
import { bollinger } from './bollinger';
import { bbpct }     from './bbpct';
import type { Indicator } from './types';
import {
  abandonedBabyBearish,
  abandonedBabyBullish,
  identicalThreeCrows,
  advanceBlock,
  bearishDojiStar
} from '../patterns';

// The registry stores all indicators under their widened default param type.
// Callers pass Record<string,number> params (from the store) which satisfies
// each indicator's P constraint because P extends Record<string,number>.
// Keyed by each indicator's own .id field (snake_case) so store lookups
// via ai.id always resolve correctly — regardless of the import variable name.
export const INDICATORS: Record<string, Indicator<Record<string, number>>> = {
  [ema.id]:                  ema,
  [sma.id]:                  sma,
  [rsi.id]:                  rsi,
  [macd.id]:                 macd,
  [bollinger.id]:            bollinger,
  [bbpct.id]:                bbpct,
  [abandonedBabyBearish.id]: abandonedBabyBearish,
  [abandonedBabyBullish.id]: abandonedBabyBullish,
  [identicalThreeCrows.id]:  identicalThreeCrows,
  [advanceBlock.id]:         advanceBlock,
  [bearishDojiStar.id]:      bearishDojiStar,
};
