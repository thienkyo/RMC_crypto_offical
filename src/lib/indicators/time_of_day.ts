import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface TimeOfDayParams {
  /** Window start — total minutes from midnight (0–1439). e.g. 480 = 08:00 */
  start:          number;
  /** Window end   — total minutes from midnight (0–1439). e.g. 1320 = 22:00 */
  end:            number;
  /** UTC offset in hours. e.g. 7 for UTC+7 (Ho Chi Minh City). */
  timezoneOffset: number;
  /**
   * Which candle timestamp to compare against the window.
   *   0 = openTime  (when the candle started)
   *   1 = closeTime (when the candle closed)
   */
  timeType: number;
  [key: string]: number;
}

/**
 * Returns 1 if the chosen candle timestamp falls inside the configured
 * [start, end) time window, 0 otherwise.
 *
 * Use as an AND-filter condition with operator `> 0.5` (locked in the UI)
 * to restrict strategy signals to specific trading hours.
 *
 * Midnight-crossing windows (e.g. 22:00–02:00) are supported: whenever
 * end < start the check wraps around midnight automatically.
 */
export const time_of_day: Indicator<TimeOfDayParams> = {
  id:   'time_of_day',
  name: 'Time of Day',
  description:
    'Returns 1 when the candle\'s chosen timestamp (open or close) falls inside ' +
    'the configured time window, 0 otherwise.\n\n' +
    'Use as an AND-filter condition to restrict entry signals to specific sessions ' +
    '(e.g. London open 15:00–18:00 UTC+7, NY session 20:00–23:00 UTC+7).\n\n' +
    'Midnight-crossing windows are supported (e.g. 22:00–02:00).\n' +
    'The operator and threshold are fixed at > 0.5 — you only need to set the window.',

  hideThreshold: true,

  defaultParams: {
    start:          480,  // 08:00
    end:            1320, // 22:00
    timezoneOffset: 7,
    timeType:       1,    // closeTime
  },

  paramsMeta: {
    start:          { type: 'time',   label: 'Start' },
    end:            { type: 'time',   label: 'End' },
    timezoneOffset: { type: 'number', label: 'UTC offset', min: -12, max: 14, step: 0.5 },
    timeType: {
      type: 'select',
      label: 'Time source',
      options: [
        { label: 'Open time',  value: 0 },
        { label: 'Close time', value: 1 },
      ],
    },
  },

  compute(candles: Candle[], params: TimeOfDayParams): IndicatorResult {
    const { start, end, timezoneOffset, timeType } = params;
    const offsetMs = timezoneOffset * 3_600_000;

    const data = candles.map((candle) => {
      const rawTs   = timeType === 1 ? candle.closeTime : candle.openTime;
      const localMs = rawTs + offsetMs;
      const d       = new Date(localMs);
      const mins    = d.getUTCHours() * 60 + d.getUTCMinutes();

      // Midnight-crossing: end < start means the window wraps (e.g. 22:00–02:00)
      const inWindow = end >= start
        ? mins >= start && mins < end          // normal window
        : mins >= start || mins < end;          // crosses midnight

      return { time: candle.openTime, value: inWindow ? 1 : 0 };
    });

    return [{
      id:         'time_of_day_window',
      name:       'In window',
      data,
      panel:      'sub',
      color:      '#06b6d4', // cyan
      lineWidth:  1.5,
      seriesType: 'line',
    }];
  },
};
