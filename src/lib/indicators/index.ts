/**
 * Indicator registry — single source of truth used by:
 *   • Chart overlay renderer (Phase 1)
 *   • Strategy condition builder (Phase 2)
 *   • Backtester (Phase 2)
 *
 * To add a new indicator: implement the Indicator<P> interface,
 * import it here, and add it to INDICATORS.
 */
export { ema }          from './ema';
export { sma }          from './sma';
export { rsi }          from './rsi';
export { macd }         from './macd';
export { bollinger }    from './bollinger';
export { bbpct }        from './bbpct';
export { bb_width }     from './bb_width';
export { adx }          from './adx';
export { stochrsi }     from './stochrsi';
export { stochastic }   from './stochastic';
export { volume_ratio } from './volume_ratio';
export { ema_dev }      from './ema_dev';
export { time_of_day }    from './time_of_day';
export { volume_profile } from './volume_profile';
export { cvd }              from './cvd';
export { cvd_divergence }   from './cvd_divergence';

// Patterns
export {
  abandonedBabyBearish,
  abandonedBabyBullish,
  identicalThreeCrows,
  advanceBlock,
  bearishDojiStar,
  beltHoldBearish,
  beltHoldBullish,
  breakawayBearish,
  breakawayBullish,
  bullishDojiStar,
  threeWhiteSoldiers,
  bullishEngulfing,
  bearishEngulfing,
  hammer,
  shootingStar,
  bullishFVG,
  bearishFVG,
  bullishLiquiditySweep,
  bearishLiquiditySweep,
  bullishAbsorption,
  bearishAbsorption,
} from '../patterns';

export type {
  Indicator,
  IndicatorResult,
  IndicatorSeries,
  IndicatorPoint,
  IndicatorMarker,
  ParamMeta,
} from './types';

import { ema }          from './ema';
import { sma }          from './sma';
import { rsi }          from './rsi';
import { macd }         from './macd';
import { bollinger }    from './bollinger';
import { bbpct }        from './bbpct';
import { bb_width }     from './bb_width';
import { adx }          from './adx';
import { stochrsi }     from './stochrsi';
import { stochastic }   from './stochastic';
import { volume_ratio } from './volume_ratio';
import { ema_dev }      from './ema_dev';
import { time_of_day }  from './time_of_day';
import type { Indicator } from './types';
import {
  abandonedBabyBearish,
  abandonedBabyBullish,
  identicalThreeCrows,
  advanceBlock,
  bearishDojiStar,
  beltHoldBearish,
  beltHoldBullish,
  breakawayBearish,
  breakawayBullish,
  bullishDojiStar,
  threeWhiteSoldiers,
  bullishEngulfing,
  bearishEngulfing,
  hammer,
  shootingStar,
  bullishFVG,
  bearishFVG,
  bullishLiquiditySweep,
  bearishLiquiditySweep,
  bullishAbsorption,
  bearishAbsorption,
} from '../patterns';
import { volume_profile } from './volume_profile';
import { cvd }            from './cvd';
import { cvd_divergence } from './cvd_divergence';

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
  [bb_width.id]:             bb_width,
  [adx.id]:                  adx,
  [stochrsi.id]:             stochrsi,
  [stochastic.id]:           stochastic,
  [volume_ratio.id]:         volume_ratio,
  [ema_dev.id]:              ema_dev,
  [time_of_day.id]:          time_of_day,
  [abandonedBabyBearish.id]: abandonedBabyBearish,
  [abandonedBabyBullish.id]: abandonedBabyBullish,
  [identicalThreeCrows.id]:  identicalThreeCrows,
  [advanceBlock.id]:         advanceBlock,
  [bearishDojiStar.id]:      bearishDojiStar,
  [beltHoldBearish.id]:      beltHoldBearish,
  [beltHoldBullish.id]:      beltHoldBullish,
  [breakawayBearish.id]:     breakawayBearish,
  [breakawayBullish.id]:     breakawayBullish,
  [bullishDojiStar.id]:      bullishDojiStar,
  [threeWhiteSoldiers.id]:   threeWhiteSoldiers,
  [bullishEngulfing.id]:     bullishEngulfing,
  [bearishEngulfing.id]:     bearishEngulfing,
  [hammer.id]:                  hammer,
  [shootingStar.id]:            shootingStar,
  [bullishFVG.id]:              bullishFVG,
  [bearishFVG.id]:              bearishFVG,
  [bullishLiquiditySweep.id]:   bullishLiquiditySweep,
  [bearishLiquiditySweep.id]:   bearishLiquiditySweep,
  [volume_profile.id]:          volume_profile,
  [cvd.id]:                     cvd,
  [bullishAbsorption.id]:       bullishAbsorption,
  [bearishAbsorption.id]:       bearishAbsorption,
  [cvd_divergence.id]:          cvd_divergence,
};
